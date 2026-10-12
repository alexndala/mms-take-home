import type { Author, Media, Post, Revision } from '../src/api/types'

/** One seeded post plus its history, stored by the mock. */
export interface SeedPost {
  post: Post
  createdAtMs: number
  revisions: Revision[]
}

export interface SeedData {
  posts: SeedPost[]
  mediaIds: Set<string>
  /** The assumed authenticated viewer, used as the author of newly published posts. */
  self: Author
}

const MINUTE = 60_000
const TOTAL_POSTS = 45
const EDIT_WINDOW_MS = 15 * MINUTE

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export function postIdFor(n: number): string {
  return `p_01JBCHIRP${pad(n, 16)}`
}

function userIdFor(n: number): string {
  return `u_01JBCHIRP${pad(n, 16)}`
}

function mediaIdFor(n: number): string {
  return `m_01JBCHIRP${pad(n, 16)}`
}

function avatarUrl(initial: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${color}"/><text x="40" y="53" font-size="38" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${initial}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function imageUrl(label: string, width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#cbd5e1"/><text x="50%" y="50%" font-size="40" text-anchor="middle" dominant-baseline="middle" fill="#334155" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

interface ProfileSpec {
  handle: string
  displayName: string
  initial: string
  color: string
}

const PROFILE_SPECS: readonly ProfileSpec[] = [
  { handle: 'ada', displayName: 'Ada L.', initial: 'A', color: '#4f46e5' },
  { handle: 'nova', displayName: 'Nova', initial: 'N', color: '#0891b2' },
  { handle: 'kai', displayName: 'Kai', initial: 'K', color: '#16a34a' },
  { handle: 'mira', displayName: 'Mira', initial: 'M', color: '#db2777' },
  { handle: 'tess', displayName: 'Tess', initial: 'T', color: '#d97706' },
]

const BODY_SAMPLES: readonly string[] = [
  'morning all - shipping day',
  'the pull-based fanout is finally holding at peak',
  'reading the cursor as an opaque string was the right call',
  'coffee, then a long walk to think about cache invalidation',
  'the edit window is 15 minutes; pass it and the post is frozen',
  'wrote a small reducer test for the optimistic rollback',
  'celebrity posts are merged at read time, never fanned out',
  'keyset pagination: anchored to a value, not a count',
  'a page of 20 posts is 20 hydration lookups',
]

/** Build a deterministic set of authors and 45 posts ending roughly "now". */
export function buildSeed(now: number): SeedData {
  const self: Author = {
    user_id: userIdFor(1),
    handle: 'you',
    display_name: 'You',
    avatar_url: avatarUrl('Y', '#334155'),
  }

  const authors: Author[] = PROFILE_SPECS.map((spec, index) => ({
    user_id: userIdFor(index + 100),
    handle: spec.handle,
    display_name: spec.displayName,
    avatar_url: avatarUrl(spec.initial, spec.color),
  }))

  const posts: SeedPost[] = []
  const mediaIds = new Set<string>()
  let mediaCounter = 0

  for (let index = 0; index < TOTAL_POSTS; index += 1) {
    const author = authors[index % authors.length]
    if (author === undefined) {
      continue
    }

    const createdAtMs = now - MINUTE - index * 6 * MINUTE
    const id = postIdFor(index + 1)
    const sample = BODY_SAMPLES[index % BODY_SAMPLES.length] ?? 'a post'
    const isEdited = index === 4 // one edited post with a real revision history

    let media: Media | null = null
    if (index % 9 === 0) {
      mediaCounter += 1
      const mid = mediaIdFor(mediaCounter)
      mediaIds.add(mid)
      media = {
        media_id: mid,
        type: 'image',
        // The newest post is left processing to exercise the non-ready branch.
        status: index === 0 ? 'processing' : 'ready',
        thumb_url: imageUrl('thumb', 160, 105),
        medium_url: imageUrl('image', 640, 420),
        full_url: imageUrl('full', 1280, 840),
        width: 1200,
        height: 800,
      }
    }

    const createdIso = new Date(createdAtMs).toISOString()
    const editedAtMs = createdAtMs + 10 * MINUTE
    const editedIso = new Date(editedAtMs).toISOString()
    const body = isEdited ? `${sample} (edited)` : sample

    const post: Post = {
      post_id: id,
      author,
      body,
      created_at: createdIso,
      edited: isEdited,
      edited_at: isEdited ? editedIso : null,
      revision: isEdited ? 2 : 1,
      media,
      permalink: `https://chirp.example/p/${id}`,
    }

    const revisions: Revision[] = isEdited
      ? [
          { revision: 1, body: sample, editor_id: author.user_id, edited_at: createdIso },
          { revision: 2, body, editor_id: author.user_id, edited_at: editedIso },
        ]
      : [{ revision: 1, body, editor_id: author.user_id, edited_at: createdIso }]

    posts.push({ post, createdAtMs, revisions })
  }

  return { posts, mediaIds, self }
}

export { EDIT_WINDOW_MS }
