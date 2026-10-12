import type { ApiError } from '../api/errors'

export interface PublishErrorBannerProps {
  error: ApiError
  onRetry: () => void
  onDismiss: () => void
}

/**
 * Publish failure banner. Shows the error model's `message`, `code` and `request_id`, and offers
 * retry only when the server marked the error retryable (section 5.5).
 */
export function PublishErrorBanner({ error, onRetry, onDismiss }: PublishErrorBannerProps) {
  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__text">
        <strong>Could not publish.</strong> {error.message}
        <span className="banner__meta">
          <code>{error.code}</code>
          <span aria-hidden="true"> · </span>
          <span className="banner__request">request {error.requestId}</span>
        </span>
      </div>
      <div className="banner__actions">
        {error.retryable && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
