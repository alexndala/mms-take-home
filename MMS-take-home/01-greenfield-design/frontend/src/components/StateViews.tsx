import type { ApiError } from '../api/errors'

/** Initial/refresh loading state. */
export function LoadingState() {
  return (
    <p className="state state--loading" role="status">
      Loading timeline…
    </p>
  )
}

/** No posts to show. */
export function EmptyState() {
  return (
    <p className="state state--empty">
      Your timeline is empty. Follow some accounts, or write the first post.
    </p>
  )
}

/**
 * Error state rendered from the section 5.5 error model: the message and code come from the
 * server, and `retryable` decides whether a retry is offered. Never a bare string.
 */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__message">{error.message}</p>
      <p className="state__meta">
        <code>{error.code}</code>
        <span aria-hidden="true"> · </span>
        <span className="state__request">request {error.requestId}</span>
      </p>
      {error.retryable && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
