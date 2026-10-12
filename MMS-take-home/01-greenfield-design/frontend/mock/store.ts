import type { Author, Cursor, Post, Revision } from '../src/api/types'
import { decodeCursor, encodeCursor } from './cursor'
import { EDIT_WINDOW_MS, postIdFor, type SeedData, type SeedPost } from './seed'

export interface TimelineEntry {
  postId: string
  createdAtMs: number
}

interface OrderKey {
  createdAtMs: number
  postId: string
}

/** Newest first: `(created_at DESC, post_id DESC)` (section 5.3). */
function compareDesc(a: OrderKey, b: OrderKey): number {
  if (a.createdAtMs !== b.createdAtMs) {
    return b.createdAtMs - a.createdAtMs
  }
  if (a.postId === b.postId) {
    return 0
  }
  return a.postId > b.postId ? -1 : 1
}

export type TimelineResult =
  | { ok: true; items: Post[]; nextCursor: Cursor | null }
  | { ok: false; reason: 'bad-cursor' }

export type RevisionsResult =
  | { ok: true; items: Revision[]; nextCursor: Cursor | null }
  | { ok: false; reason: 'not-found' | 'bad-cursor' }

export type PublishOutcome =
  | { status: 'created'; post: Post }
  | { status: 'replayed'; post: Post }
  | { status: 'idempotency-conflict' }

export type EditOutcome =
  | { status: 'ok'; post: Post }
  | { status: 'not-found' }
  | { status: 'window-closed'; editableUntil: string }
  | { status: 'stale'; currentRevision: number }

/** In-memory implementation of the section 5 stores, scoped to the assumed single viewer. */
export class MockStore {
  private readonly byId = new Map<string, SeedPost>()
  private readonly timeline: TimelineEntry[] = []
  private readonly idempotency = new Map<string, { requestHash: string; postId: string }>()
  private readonly knownMediaIds: Set<string>
  private readonly self: Author
  private readonly now: () => number
  private sequence: number

  constructor(data: SeedData, now: () => number = Date.now) {
    this.self = data.self
    this.knownMediaIds = data.mediaIds
    this.now = now
    for (const seed of data.posts) {
      this.byId.set(seed.post.post_id, seed)
      this.timeline.push({ postId: seed.post.post_id, createdAtMs: seed.createdAtMs })
    }
    this.timeline.sort(compareDesc)
    this.sequence = data.posts.length
  }

  getPost(id: string): Post | undefined {
    return this.byId.get(id)?.post
  }

  hasMedia(id: string): boolean {
    return this.knownMediaIds.has(id)
  }

  /** One page of the home timeline, strictly older than `cursor` when provided. */
  listTimeline(cursor: Cursor | null, limit: number): TimelineResult {
    let entries = this.timeline
    if (cursor !== null) {
      const parts = decodeCursor(cursor)
      if (parts === null) {
        return { ok: false, reason: 'bad-cursor' }
      }
      entries = entries.filter((entry) => compareDesc(entry, parts) > 0)
    }

    const page = entries.slice(0, limit)
    const items: Post[] = []
    for (const entry of page) {
      const seed = this.byId.get(entry.postId)
      if (seed !== undefined) {
        items.push(seed.post)
      }
    }

    const last = page[page.length - 1]
    const hasMore = entries.length > page.length
    const nextCursor = hasMore && last !== undefined ? encodeCursor(last.createdAtMs, last.postId) : null
    return { ok: true, items, nextCursor }
  }

  /** Revisions for one post, newest-first, keyset-paginated on revision number. */
  listRevisions(id: string, cursor: Cursor | null, limit: number): RevisionsResult {
    const seed = this.byId.get(id)
    if (seed === undefined) {
      return { ok: false, reason: 'not-found' }
    }

    const all = [...seed.revisions].sort((a, b) => b.revision - a.revision)
    let list = all
    if (cursor !== null) {
      const parts = decodeCursor(cursor)
      if (parts === null) {
        return { ok: false, reason: 'bad-cursor' }
      }
      const cursorRevision = Number(parts.postId)
      if (!Number.isFinite(cursorRevision)) {
        return { ok: false, reason: 'bad-cursor' }
      }
      list = all.filter((revision) => revision.revision < cursorRevision)
    }

    const page = list.slice(0, limit)
    const last = page[page.length - 1]
    const hasMore = list.length > page.length
    const nextCursor =
      hasMore && last !== undefined ? encodeCursor(Date.parse(last.edited_at), String(last.revision)) : null
    return { ok: true, items: page, nextCursor }
  }

  publish(body: string, idempotencyKey: string, requestHash: string): PublishOutcome {
    const existing = this.idempotency.get(idempotencyKey)
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        return { status: 'idempotency-conflict' }
      }
      const seed = this.byId.get(existing.postId)
      if (seed !== undefined) {
        return { status: 'replayed', post: seed.post }
      }
    }

    const createdAtMs = this.now()
    this.sequence += 1
    const id = postIdFor(this.sequence)
    const createdIso = new Date(createdAtMs).toISOString()
    const post: Post = {
      post_id: id,
      author: this.self,
      body,
      created_at: createdIso,
      edited: false,
      edited_at: null,
      revision: 1,
      media: null,
      permalink: `https://chirp.example/p/${id}`,
    }
    const seed: SeedPost = {
      post,
      createdAtMs,
      revisions: [{ revision: 1, body, editor_id: this.self.user_id, edited_at: createdIso }],
    }

    this.byId.set(id, seed)
    this.timeline.push({ postId: id, createdAtMs })
    this.timeline.sort(compareDesc)
    this.idempotency.set(idempotencyKey, { requestHash, postId: id })
    return { status: 'created', post }
  }

  edit(id: string, body: string, ifMatch: number): EditOutcome {
    const seed = this.byId.get(id)
    if (seed === undefined) {
      return { status: 'not-found' }
    }

    const editableUntilMs = seed.createdAtMs + EDIT_WINDOW_MS
    if (this.now() > editableUntilMs) {
      return { status: 'window-closed', editableUntil: new Date(editableUntilMs).toISOString() }
    }

    if (seed.post.revision !== ifMatch) {
      return { status: 'stale', currentRevision: seed.post.revision }
    }

    const editedIso = new Date(this.now()).toISOString()
    const nextRevision = seed.post.revision + 1
    const updated: Post = {
      ...seed.post,
      body,
      edited: true,
      edited_at: editedIso,
      revision: nextRevision,
    }
    seed.post = updated
    seed.revisions.push({
      revision: nextRevision,
      body,
      editor_id: updated.author.user_id,
      edited_at: editedIso,
    })
    return { status: 'ok', post: updated }
  }
}
