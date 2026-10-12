/**
 * Chirp mock server.
 *
 * Implements the section 5 contract against an in-memory store: real keyset cursors, real
 * `Idempotency-Key` and `If-Match` semantics, the 15-minute edit window, and the section 5.5 error
 * model on every failure. The failure path is reachable without editing code, via `?mock_fail=1`
 * or the `MOCK_FAIL_MODE` environment variable (`timeline` | `publish` | `all`).
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { errorBody } from './errors'
import { buildSeed } from './seed'
import { MockStore } from './store'

const MAX_BODY = 500
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

type FailMode = 'all' | 'timeline' | 'publish'

function activeFailMode(injected: boolean): FailMode | null {
  if (injected) {
    return 'all'
  }
  const mode = process.env['MOCK_FAIL_MODE']
  if (mode === 'all' || mode === 'timeline' || mode === 'publish') {
    return mode
  }
  return null
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) {
    return DEFAULT_LIMIT
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    return null
  }
  return parsed
}

const store = new MockStore(buildSeed(Date.now()))
const app = new Hono()

app.use('*', async (c, next) => {
  const mode = activeFailMode(c.req.query('mock_fail') === '1')
  if (mode !== null) {
    const isTimeline = c.req.method === 'GET' && c.req.path.endsWith('/timelines/home')
    const isPublish = c.req.method === 'POST' && c.req.path.endsWith('/posts')
    if (mode === 'all' || (mode === 'timeline' && isTimeline) || (mode === 'publish' && isPublish)) {
      return c.json(
        errorBody('SERVICE_UNAVAILABLE', 'The mock is configured to fail this request.', {
          retryable: true,
        }),
        503,
      )
    }
  }
  await next()
})

app.get('/', (c) => c.text('Chirp mock running. Try GET /v1/timelines/home\n'))

app.get('/v1/timelines/home', (c) => {
  const limit = parseLimit(c.req.query('limit'))
  if (limit === null) {
    return c.json(errorBody('INVALID_LIMIT', 'limit must be an integer between 1 and 50.'), 400)
  }
  const cursor = c.req.query('cursor') ?? null
  const result = store.listTimeline(cursor, limit)
  if (!result.ok) {
    return c.json(errorBody('BAD_CURSOR', 'The cursor is not valid.'), 400)
  }
  return c.json(
    {
      items: result.items,
      next_cursor: result.nextCursor,
      generated_at: new Date().toISOString(),
    },
    200,
  )
})

app.post('/v1/posts', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')
  if (idempotencyKey === undefined || idempotencyKey.length === 0) {
    return c.json(errorBody('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.'), 400)
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(errorBody('MALFORMED_REQUEST', 'Request body is not valid JSON.'), 400)
  }
  if (typeof raw !== 'object' || raw === null) {
    return c.json(errorBody('MALFORMED_REQUEST', 'Request body must be a JSON object.'), 400)
  }

  const record = raw as Record<string, unknown>
  const body = record['body']
  const mediaIdRaw = record['media_id']
  if (typeof body !== 'string') {
    return c.json(errorBody('MALFORMED_REQUEST', 'body must be a string.'), 400)
  }
  if (mediaIdRaw !== null && mediaIdRaw !== undefined && typeof mediaIdRaw !== 'string') {
    return c.json(errorBody('MALFORMED_REQUEST', 'media_id must be a string or null.'), 400)
  }
  if (body.length === 0) {
    return c.json(errorBody('INVALID_BODY', 'Post body must be 1..500 characters.'), 422)
  }
  if (body.length > MAX_BODY) {
    return c.json(errorBody('BODY_TOO_LONG', 'Post body must be 1..500 characters.'), 413)
  }
  const mediaId = typeof mediaIdRaw === 'string' ? mediaIdRaw : null
  if (mediaId !== null && !store.hasMedia(mediaId)) {
    return c.json(
      errorBody('MEDIA_NOT_READY', 'Referenced media is not uploaded or valid.', {
        details: { media_id: mediaId },
      }),
      422,
    )
  }

  const requestHash = JSON.stringify({ body, media_id: mediaId })
  const outcome = store.publish(body, idempotencyKey, requestHash)
  switch (outcome.status) {
    case 'created':
      return c.json(outcome.post, 201)
    case 'replayed':
      return c.json(outcome.post, 201)
    case 'idempotency-conflict':
      return c.json(
        errorBody('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was reused with a different body.'),
        409,
      )
  }
})

app.get('/v1/posts/:id', (c) => {
  const post = store.getPost(c.req.param('id'))
  if (post === undefined) {
    return c.json(errorBody('POST_NOT_FOUND', 'No such post.'), 404)
  }
  return c.json(post, 200)
})

app.patch('/v1/posts/:id', async (c) => {
  const id = c.req.param('id')
  const ifMatchRaw = c.req.header('If-Match')
  if (ifMatchRaw === undefined) {
    return c.json(errorBody('IF_MATCH_REQUIRED', 'An If-Match revision header is required.'), 400)
  }
  const ifMatch = Number(ifMatchRaw)
  if (!Number.isInteger(ifMatch)) {
    return c.json(errorBody('INVALID_IF_MATCH', 'If-Match must be an integer revision.'), 400)
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json(errorBody('MALFORMED_REQUEST', 'Request body is not valid JSON.'), 400)
  }
  if (typeof raw !== 'object' || raw === null) {
    return c.json(errorBody('MALFORMED_REQUEST', 'Request body must be a JSON object.'), 400)
  }
  const body = (raw as Record<string, unknown>)['body']
  if (typeof body !== 'string') {
    return c.json(errorBody('MALFORMED_REQUEST', 'body must be a string.'), 400)
  }
  if (body.length === 0) {
    return c.json(errorBody('INVALID_BODY', 'Post body must be 1..500 characters.'), 422)
  }
  if (body.length > MAX_BODY) {
    return c.json(errorBody('BODY_TOO_LONG', 'Post body must be 1..500 characters.'), 413)
  }

  const outcome = store.edit(id, body, ifMatch)
  switch (outcome.status) {
    case 'ok':
      return c.json(outcome.post, 200)
    case 'not-found':
      return c.json(errorBody('POST_NOT_FOUND', 'No such post.'), 404)
    case 'window-closed':
      return c.json(
        errorBody('EDIT_WINDOW_CLOSED', 'This post can no longer be edited.', {
          details: { post_id: id, editable_until: outcome.editableUntil },
        }),
        409,
      )
    case 'stale':
      return c.json(
        errorBody('STALE_REVISION', 'The revision is stale; re-fetch the post and try again.', {
          details: { post_id: id, current_revision: outcome.currentRevision },
        }),
        412,
      )
  }
})

app.get('/v1/posts/:id/revisions', (c) => {
  const limit = parseLimit(c.req.query('limit'))
  if (limit === null) {
    return c.json(errorBody('INVALID_LIMIT', 'limit must be an integer between 1 and 50.'), 400)
  }
  const cursor = c.req.query('cursor') ?? null
  const result = store.listRevisions(c.req.param('id'), cursor, limit)
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return c.json(errorBody('POST_NOT_FOUND', 'No such post.'), 404)
    }
    return c.json(errorBody('BAD_CURSOR', 'The cursor is not valid.'), 400)
  }
  return c.json({ items: result.items, next_cursor: result.nextCursor }, 200)
})

const port = Number(process.env['PORT'] ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Chirp mock listening on http://localhost:${info.port}`)
})
