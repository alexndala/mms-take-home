import { useEffect, useState } from 'react'
import type { ChirpClient } from '../api/client'
import { asApiError, type ApiError } from '../api/errors'
import type { Revision } from '../api/types'
import { formatDateTime } from '../lib/format'

export interface RevisionHistoryProps {
  postId: string
  client: ChirpClient
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; revisions: Revision[] }

/**
 * On-demand edit history for one post, from `GET /posts/{post_id}/revisions` (section 5.1).
 * Revisions arrive newest-first; a post with one revision is unedited by definition.
 */
export function RevisionHistory({ postId, client }: RevisionHistoryProps) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    client
      .getRevisions(postId, { limit: 50 })
      .then((page) => {
        if (!cancelled) {
          setState({ status: 'ready', revisions: page.items })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: asApiError(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [postId, client])

  if (state.status === 'loading') {
    return <p className="history__status">Loading edit history…</p>
  }
  if (state.status === 'error') {
    return (
      <p className="history__status history__status--error" role="alert">
        {state.error.message} (<code>{state.error.code}</code>)
      </p>
    )
  }

  return (
    <ol className="history">
      {state.revisions.map((revision) => (
        <li key={revision.revision} className="history__item">
          <div className="history__head">
            <span className="history__rev">Revision {revision.revision}</span>
            <time dateTime={revision.edited_at}>{formatDateTime(revision.edited_at)}</time>
          </div>
          <p className="history__body">{revision.body}</p>
        </li>
      ))}
    </ol>
  )
}
