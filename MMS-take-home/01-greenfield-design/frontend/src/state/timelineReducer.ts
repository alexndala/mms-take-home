/**
 * Home-timeline reducer (SPEC behaviour 1, 3, 4).
 *
 * Pure and side-effect free: the components dispatch in, the server responses come back as
 * actions, and every transition is unit-tested. Optimistic insert, reconcile, rollback and
 * `post_id` de-duplication live here so the marked state handling is visible rather than hidden
 * in a data-fetching dependency.
 */

import type { ApiError } from '../api/errors'
import type { Cursor, Post } from '../api/types'

/**
 * A post shown immediately on publish, before the server confirms it. Keyed by a client-generated
 * id so the server response can be reconciled back to exactly this row.
 */
export interface OptimisticPost {
  clientId: string
  body: string
  createdAt: string
  mediaId: string | null
}

export type TimelineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TimelineState {
  items: Post[]
  nextCursor: Cursor | null
  /** Initial/refresh load. */
  status: TimelineStatus
  error: ApiError | null
  /** Pagination ("load more"), tracked separately so a failed page does not hide loaded items. */
  loadingMore: boolean
  loadMoreError: ApiError | null
  pending: OptimisticPost[]
  publishing: boolean
  publishError: ApiError | null
}

export const initialTimelineState: TimelineState = {
  items: [],
  nextCursor: null,
  status: 'idle',
  error: null,
  loadingMore: false,
  loadMoreError: null,
  pending: [],
  publishing: false,
  publishError: null,
}

export type TimelineAction =
  | { type: 'load/start' }
  | { type: 'load/success'; items: Post[]; nextCursor: Cursor | null }
  | { type: 'load/error'; error: ApiError }
  | { type: 'loadMore/start' }
  | { type: 'loadMore/success'; items: Post[]; nextCursor: Cursor | null }
  | { type: 'loadMore/error'; error: ApiError }
  | { type: 'publish/optimistic'; post: OptimisticPost }
  | { type: 'publish/success'; clientId: string; post: Post }
  | { type: 'publish/error'; clientId: string; error: ApiError }
  | { type: 'publish/dismissError' }

/** Keep the first occurrence of each `post_id`, preserving order. */
function dedupeById(posts: Post[]): Post[] {
  const seen = new Set<string>()
  const result: Post[] = []
  for (const post of posts) {
    if (!seen.has(post.post_id)) {
      seen.add(post.post_id)
      result.push(post)
    }
  }
  return result
}

/** Append `incoming` to `existing`, dropping any post whose `post_id` is already present. */
function appendUnique(existing: Post[], incoming: Post[]): Post[] {
  const seen = new Set(existing.map((post) => post.post_id))
  const result = [...existing]
  for (const post of incoming) {
    if (!seen.has(post.post_id)) {
      seen.add(post.post_id)
      result.push(post)
    }
  }
  return result
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'load/start':
      return { ...state, status: 'loading', error: null }

    case 'load/success':
      return {
        ...state,
        items: dedupeById(action.items),
        nextCursor: action.nextCursor,
        status: 'ready',
        error: null,
      }

    case 'load/error':
      return { ...state, status: 'error', error: action.error }

    case 'loadMore/start':
      return { ...state, loadingMore: true, loadMoreError: null }

    case 'loadMore/success':
      return {
        ...state,
        items: appendUnique(state.items, action.items),
        nextCursor: action.nextCursor,
        loadingMore: false,
      }

    case 'loadMore/error':
      return { ...state, loadingMore: false, loadMoreError: action.error }

    case 'publish/optimistic':
      return {
        ...state,
        pending: [...state.pending, action.post],
        publishing: true,
        publishError: null,
      }

    case 'publish/success': {
      const pending = state.pending.filter((post) => post.clientId !== action.clientId)
      // Reconcile: the confirmed post is newest, but never render a duplicate if a concurrent
      // page fetch already returned it.
      const alreadyPresent = state.items.some((post) => post.post_id === action.post.post_id)
      const items = alreadyPresent ? state.items : [action.post, ...state.items]
      return { ...state, pending, items, publishing: false, publishError: null }
    }

    case 'publish/error':
      return {
        ...state,
        pending: state.pending.filter((post) => post.clientId !== action.clientId),
        publishing: false,
        publishError: action.error,
      }

    case 'publish/dismissError':
      return { ...state, publishError: null }
  }
}
