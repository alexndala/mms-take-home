/**
 * Chirp API client (DELIVERABLE.md section 5).
 *
 * Speaks exactly the frozen contract: opaque keyset cursor, `Idempotency-Key` on publish,
 * `If-Match: <revision>` on edit, and the section 5.5 error model surfaced as `ApiError`.
 */

import { ApiError, parseError } from './errors'
import type {
  Cursor,
  EditPostRequest,
  Post,
  PublishPostRequest,
  RevisionPage,
  TimelinePage,
  TimelineQuery,
} from './types'

const DEFAULT_BASE_URL = '/v1'

/** `VITE_API_BASE` overrides the base URL (e.g. a deployed API); otherwise `/v1` is proxied. */
function readEnvBaseUrl(): string | undefined {
  const value = import.meta.env.VITE_API_BASE
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Section 5.2: the browser holds the access token in memory only; it is never persisted or put in
 * a URL. Authentication UI is out of scope (SPEC), so a credential is assumed present: a single
 * in-memory value, replaceable but never stored.
 */
let inMemoryAccessToken: string | null = 'dev-access-token'

/** Set (or clear) the in-memory access token. Exposed for completeness; no UI calls it yet. */
export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token
}

export interface ChirpClientOptions {
  /** Defaults to `/v1` (proxied to the mock in development). */
  baseUrl?: string
  /** Override how the bearer token is read. Defaults to the in-memory value from section 5.2. */
  getAccessToken?: () => string | null
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return query.length > 0 ? `?${query}` : ''
}

export class ChirpClient {
  private readonly baseUrl: string
  private readonly getAccessToken: () => string | null
  private injectFailure = false

  constructor(options: ChirpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? readEnvBaseUrl() ?? DEFAULT_BASE_URL
    this.getAccessToken = options.getAccessToken ?? (() => inMemoryAccessToken)
  }

  /**
   * Development-only affordance required by the SPEC: make the error path reachable without
   * editing code. When enabled, requests carry `?mock_fail=1`, which the mock honours. This is not
   * part of the production contract; the real gateway would ignore an unknown query parameter.
   */
  setFailureInjection(enabled: boolean): void {
    this.injectFailure = enabled
  }

  /** `GET /timelines/home?limit&cursor` -> `{ items, next_cursor, generated_at }`. */
  async getHomeTimeline(query: TimelineQuery = {}): Promise<TimelinePage> {
    const path = `/timelines/home${buildQuery({ limit: query.limit, cursor: query.cursor })}`
    const response = await this.request(path, { method: 'GET' })
    return (await response.json()) as TimelinePage
  }

  /**
   * `POST /posts` -> `201 Post`.
   *
   * The idempotency key is supplied by the caller so one key is generated per *user intent* and
   * reused across retries (section 5.4): a retry can never create a duplicate post.
   */
  async publishPost(input: PublishPostRequest, idempotencyKey: string): Promise<Post> {
    const payload: PublishPostRequest = { body: input.body, media_id: input.media_id }
    const response = await this.request('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    })
    return (await response.json()) as Post
  }

  /** `PATCH /posts/{post_id}` -> `200 Post`. Guarded by `If-Match: <revision>`. */
  async editPost(postId: string, body: string, revision: number): Promise<Post> {
    const payload: EditPostRequest = { body }
    const response = await this.request(`/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) },
      body: JSON.stringify(payload),
    })
    return (await response.json()) as Post
  }

  /** `GET /posts/{post_id}/revisions?limit&cursor` -> `{ items, next_cursor }`, newest-first. */
  async getRevisions(postId: string, query: TimelineQuery = {}): Promise<RevisionPage> {
    const path = `/posts/${encodeURIComponent(postId)}/revisions${buildQuery({
      limit: query.limit,
      cursor: query.cursor,
    })}`
    const response = await this.request(path, { method: 'GET' })
    return (await response.json()) as RevisionPage
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    const token = this.getAccessToken()
    if (token !== null) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${this.applyFailureInjection(path)}`, {
        ...init,
        headers,
      })
    } catch {
      // Transport failure: no status, but the same error shape and a retryable flag.
      throw new ApiError(
        {
          code: 'NETWORK_ERROR',
          message: 'Could not reach the Chirp API. Check your connection and retry.',
          retryable: true,
          request_id: 'client',
        },
        0,
      )
    }

    if (!response.ok) {
      throw await parseError(response)
    }
    return response
  }

  private applyFailureInjection(path: string): string {
    if (!this.injectFailure) {
      return path
    }
    const url = new URL(path, 'http://localhost')
    url.searchParams.set('mock_fail', '1')
    return `${url.pathname}${url.search}`
  }
}

export type { Cursor }
