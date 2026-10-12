/**
 * Keyset cursor codec for the mock: `base64url(created_at_epoch_ms ":" post_id)` per section 5.3.
 *
 * Only the mock encodes and decodes cursors. The frontend treats them as opaque strings, so this
 * module is intentionally server-side.
 */

export interface CursorParts {
  createdAtMs: number
  postId: string
}

export function encodeCursor(createdAtMs: number, postId: string): string {
  return Buffer.from(`${createdAtMs}:${postId}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): CursorParts | null {
  let raw: string
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const separator = raw.indexOf(':')
  if (separator <= 0) {
    return null
  }
  const createdAtMs = Number(raw.slice(0, separator))
  const postId = raw.slice(separator + 1)
  if (!Number.isFinite(createdAtMs) || postId.length === 0) {
    return null
  }
  return { createdAtMs, postId }
}
