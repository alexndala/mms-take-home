import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors'
import type { Post } from '../api/types'
import {
  initialTimelineState,
  timelineReducer,
  type OptimisticPost,
  type TimelineAction,
  type TimelineState,
} from './timelineReducer'

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    post_id: 'p_default',
    author: {
      user_id: 'u_ada',
      handle: 'ada',
      display_name: 'Ada L.',
      avatar_url: 'https://cdn.chirp.example/avatars/ada.jpg',
    },
    body: 'hello, timeline',
    created_at: '2026-10-10T21:00:00Z',
    edited: false,
    edited_at: null,
    revision: 1,
    media: null,
    permalink: 'https://chirp.example/p/p_default',
    ...overrides,
  }
}

function makeOptimistic(clientId: string, body = 'draft'): OptimisticPost {
  return { clientId, body, createdAt: '2026-10-10T21:00:00Z', mediaId: null }
}

function makeError(code: string): ApiError {
  return new ApiError({ code, message: `error ${code}`, retryable: false, request_id: 'req_1' }, 500)
}

function reduce(state: TimelineState, ...actions: TimelineAction[]): TimelineState {
  return actions.reduce(timelineReducer, state)
}

describe('timelineReducer', () => {
  it('load/success replaces items and de-dupes by post_id', () => {
    const a = makePost({ post_id: 'p_a' })
    const b = makePost({ post_id: 'p_b' })

    const state = reduce(initialTimelineState, {
      type: 'load/success',
      items: [a, b, a],
      nextCursor: 'c1',
    })

    expect(state.items.map((post) => post.post_id)).toEqual(['p_a', 'p_b'])
    expect(state.status).toBe('ready')
    expect(state.nextCursor).toBe('c1')
  })

  it('loadMore/success appends only unseen posts', () => {
    const a = makePost({ post_id: 'p_a' })
    const b = makePost({ post_id: 'p_b' })

    const state = reduce(
      initialTimelineState,
      { type: 'load/success', items: [a], nextCursor: 'c1' },
      { type: 'loadMore/start' },
      { type: 'loadMore/success', items: [a, b], nextCursor: 'c2' },
    )

    expect(state.items.map((post) => post.post_id)).toEqual(['p_a', 'p_b'])
    expect(state.nextCursor).toBe('c2')
    expect(state.loadingMore).toBe(false)
  })

  it('loadMore/error keeps loaded items and records a separate error', () => {
    const a = makePost({ post_id: 'p_a' })

    const state = reduce(
      initialTimelineState,
      { type: 'load/success', items: [a], nextCursor: 'c1' },
      { type: 'loadMore/start' },
      { type: 'loadMore/error', error: makeError('RATE_LIMITED') },
    )

    expect(state.items).toHaveLength(1)
    expect(state.status).toBe('ready')
    expect(state.loadingMore).toBe(false)
    expect(state.loadMoreError?.code).toBe('RATE_LIMITED')
  })

  it('load/error sets the error status from the error model', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'load/start' },
      { type: 'load/error', error: makeError('SERVICE_UNAVAILABLE') },
    )

    expect(state.status).toBe('error')
    expect(state.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(state.error?.message).toBe('error SERVICE_UNAVAILABLE')
  })

  it('optimistic insert then success reconciles to a single top item', () => {
    const confirmed = makePost({ post_id: 'p_new', body: 'shipped' })

    const state = reduce(
      initialTimelineState,
      { type: 'publish/optimistic', post: makeOptimistic('c1', 'shipped') },
      { type: 'publish/success', clientId: 'c1', post: confirmed },
    )

    expect(state.pending).toHaveLength(0)
    expect(state.items.map((post) => post.post_id)).toEqual(['p_new'])
    expect(state.publishing).toBe(false)
    expect(state.publishError).toBeNull()
  })

  it('optimistic insert then error rolls back and surfaces the error', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'publish/optimistic', post: makeOptimistic('c1') },
      { type: 'publish/error', clientId: 'c1', error: makeError('RATE_LIMITED') },
    )

    expect(state.pending).toHaveLength(0)
    expect(state.items).toHaveLength(0)
    expect(state.publishing).toBe(false)
    expect(state.publishError?.code).toBe('RATE_LIMITED')
  })

  it('does not duplicate a post that a concurrent page fetch already returned', () => {
    const raced = makePost({ post_id: 'p_race' })

    const state = reduce(
      initialTimelineState,
      { type: 'load/success', items: [raced], nextCursor: null },
      { type: 'publish/optimistic', post: makeOptimistic('c1') },
      // load-more arrives while the publish is in flight and includes the same post
      { type: 'loadMore/success', items: [raced], nextCursor: null },
      { type: 'publish/success', clientId: 'c1', post: raced },
    )

    expect(state.items.filter((post) => post.post_id === 'p_race')).toHaveLength(1)
    expect(state.pending).toHaveLength(0)
  })

  it('dismiss clears the publish error', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'publish/error', clientId: 'c1', error: makeError('EDIT_WINDOW_CLOSED') },
      { type: 'publish/dismissError' },
    )

    expect(state.publishError).toBeNull()
  })
})
