/**
 * The Chirp error model (DELIVERABLE.md section 5.5).
 *
 * Every failed request returns a single shape and a non-2xx status:
 *
 *   { "error": { "code", "message", "retryable", "request_id", "details"? } }
 *
 * The frontend renders from `code` and `message`, never from an HTTP status-code guess:
 * `retryable` is set by the server and is authoritative.
 */

/** Error codes are open-ended strings defined by the server; only this one is named in §5.5. */
export const KNOWN_ERROR_CODES = {
  EDIT_WINDOW_CLOSED: 'EDIT_WINDOW_CLOSED',
} as const

/** The `error` object inside the envelope. */
export interface ApiErrorInfo {
  code: string
  message: string
  retryable: boolean
  request_id: string
  details?: Record<string, unknown>
}

/** The full error envelope, exactly as documented. */
export interface ApiErrorEnvelope {
  error: ApiErrorInfo
}

/** Type guard for a value parsed from an error response body. */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }
  const error: unknown = (value as { error: unknown }).error
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const record = error as Record<string, unknown>
  return (
    typeof record['code'] === 'string' &&
    typeof record['message'] === 'string' &&
    typeof record['retryable'] === 'boolean' &&
    typeof record['request_id'] === 'string'
  )
}

/**
 * A parsed API error. Carries the contract fields plus the HTTP status for diagnostics.
 * The UI must present `message` (and may use `code`, `request_id`, `retryable`); it must not
 * branch on `status`.
 */
export class ApiError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(info: ApiErrorInfo, status: number) {
    super(info.message)
    this.name = 'ApiError'
    this.code = info.code
    this.retryable = info.retryable
    this.requestId = info.request_id
    this.status = status
    this.details = info.details
  }
}

/** Retryability fallback used only when the response has no parseable error envelope. */
function fallbackRetryable(status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * Parse a non-2xx `Response` into an `ApiError`. If the body is missing or does not match the
 * documented envelope, a status-derived fallback is used so the UI still has a code and message.
 */
export async function parseError(response: Response): Promise<ApiError> {
  let info: ApiErrorInfo = {
    code: 'UNKNOWN_ERROR',
    message: `Request failed with status ${response.status}`,
    retryable: fallbackRetryable(response.status),
    request_id: 'unknown',
  }

  try {
    const body: unknown = await response.json()
    if (isApiErrorEnvelope(body)) {
      info = body.error
    }
  } catch {
    // Non-JSON or empty body: keep the status-derived fallback.
  }

  return new ApiError(info, response.status)
}
