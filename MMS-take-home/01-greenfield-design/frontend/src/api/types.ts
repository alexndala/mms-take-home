/**
 * API types for the Chirp frontend.
 *
 * These mirror `01-greenfield-design/DELIVERABLE.md` section 5.1 exactly. Every field name and
 * nullability below is traceable to that document; the frontend compiles against these types so
 * that code and contract cannot drift.
 *
 * The base URL is `https://api.chirp.example/v1`; in development it is proxied from `/v1`.
 */

/**
 * Opaque keyset cursor, `base64url(created_at_epoch_ms ":" post_id)` per section 5.3.
 *
 * The client never encodes or decodes this value; it is echoed back verbatim from
 * `next_cursor`. Modelling it as an opaque `string` (not a parsed structure) is deliberate.
 */
export type Cursor = string

/** Post author, embedded in every `Post`. */
export interface Author {
  user_id: string
  handle: string
  display_name: string
  avatar_url: string
}

/**
 * Media attached to a post. Only `image` is defined by the contract. `status` transitions
 * asynchronously from `processing` to `ready` or `blocked` (section 5.1).
 */
export interface Media {
  media_id: string
  type: 'image'
  status: 'processing' | 'ready' | 'blocked'
  thumb_url: string
  medium_url: string
  full_url: string
  width: number
  height: number
}

/**
 * A post as returned by publish, timeline, and single-post reads.
 *
 * `media` is `null` when the post has no image. `edited` is `false` and `edited_at` is `null`
 * on an unedited post; `revision` starts at `1` on publish and increments per edit.
 */
export interface Post {
  post_id: string
  author: Author
  body: string
  created_at: string
  edited: boolean
  edited_at: string | null
  revision: number
  media: Media | null
  permalink: string
}

/** A single entry in a post's edit history (section 5.1). */
export interface Revision {
  revision: number
  body: string
  editor_id: string
  edited_at: string
}

/** `GET /timelines/home` response body (section 5.1). */
export interface TimelinePage {
  items: Post[]
  next_cursor: Cursor | null
  generated_at: string
}

/** `GET /posts/{post_id}/revisions` response body, newest-first (section 5.1). */
export interface RevisionPage {
  items: Revision[]
  next_cursor: Cursor | null
}

/** `POST /posts` request body (section 5.1). */
export interface PublishPostRequest {
  body: string
  media_id: string | null
}

/** `PATCH /posts/{post_id}` request body (section 5.1). */
export interface EditPostRequest {
  body: string
}

/** Query parameters for `GET /timelines/home`; `limit` defaults to 20, max 50. */
export interface TimelineQuery {
  limit?: number
  cursor?: Cursor
}
