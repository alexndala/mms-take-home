import type { ApiErrorEnvelope, ApiErrorInfo } from '../src/api/errors'

/** Build a section 5.5 error envelope. `retryable` defaults to false, matching the contract. */
export function errorBody(
  code: string,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown>; requestId?: string } = {},
): ApiErrorEnvelope {
  const info: ApiErrorInfo = {
    code,
    message,
    retryable: options.retryable ?? false,
    request_id: options.requestId ?? newRequestId(),
    ...(options.details !== undefined ? { details: options.details } : {}),
  }
  return { error: info }
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`
}
