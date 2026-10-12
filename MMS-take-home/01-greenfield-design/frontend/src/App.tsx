import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ChirpClient } from './api/client'
import { asApiError } from './api/errors'
import { Composer } from './components/Composer'
import { PublishErrorBanner } from './components/PublishErrorBanner'
import { EmptyState, ErrorState, LoadingState } from './components/StateViews'
import { TimelineList } from './components/TimelineList'
import { initialTimelineState, timelineReducer } from './state/timelineReducer'

const PAGE_LIMIT = 20
const MAX_BODY = 500

export default function App() {
  const [client] = useState(() => new ChirpClient())
  const [state, dispatch] = useReducer(timelineReducer, initialTimelineState)
  const [injectFailure, setInjectFailure] = useState(false)

  // The idempotency key for the last publish intent, so a retry reuses it (section 5.4).
  const lastAttempt = useRef<{ body: string; idempotencyKey: string } | null>(null)

  useEffect(() => {
    client.setFailureInjection(injectFailure)
  }, [client, injectFailure])

  const load = useCallback(async () => {
    dispatch({ type: 'load/start' })
    try {
      const page = await client.getHomeTimeline({ limit: PAGE_LIMIT })
      dispatch({ type: 'load/success', items: page.items, nextCursor: page.next_cursor })
    } catch (error) {
      dispatch({ type: 'load/error', error: asApiError(error) })
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (state.nextCursor === null || state.loadingMore) {
      return
    }
    dispatch({ type: 'loadMore/start' })
    try {
      const page = await client.getHomeTimeline({ limit: PAGE_LIMIT, cursor: state.nextCursor })
      dispatch({ type: 'loadMore/success', items: page.items, nextCursor: page.next_cursor })
    } catch (error) {
      dispatch({ type: 'loadMore/error', error: asApiError(error) })
    }
  }, [client, state.nextCursor, state.loadingMore])

  const runPublish = useCallback(
    async (body: string, idempotencyKey: string) => {
      const clientId = crypto.randomUUID()
      dispatch({
        type: 'publish/optimistic',
        post: { clientId, body, createdAt: new Date().toISOString(), mediaId: null },
      })
      try {
        const post = await client.publishPost({ body, media_id: null }, idempotencyKey)
        dispatch({ type: 'publish/success', clientId, post })
      } catch (error) {
        dispatch({ type: 'publish/error', clientId, error: asApiError(error) })
      }
    },
    [client],
  )

  const publish = useCallback(
    (body: string) => {
      const idempotencyKey = crypto.randomUUID()
      lastAttempt.current = { body, idempotencyKey }
      void runPublish(body, idempotencyKey)
    },
    [runPublish],
  )

  const retryPublish = useCallback(() => {
    const attempt = lastAttempt.current
    if (attempt === null) {
      return
    }
    dispatch({ type: 'publish/dismissError' })
    void runPublish(attempt.body, attempt.idempotencyKey)
  }, [runPublish])

  const dismissPublishError = useCallback(() => {
    dispatch({ type: 'publish/dismissError' })
  }, [])

  const hasAnyPosts = state.items.length > 0 || state.pending.length > 0
  const showInitialLoading = state.status === 'loading' && !hasAnyPosts
  const showEmpty = state.status === 'ready' && !hasAnyPosts

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Chirp</h1>
        <div className="app__controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={injectFailure}
              onChange={(event) => setInjectFailure(event.target.checked)}
            />
            Inject mock failure
          </label>
          <button type="button" onClick={() => void load()} disabled={state.status === 'loading'}>
            Refresh
          </button>
        </div>
      </header>

      <Composer maxLength={MAX_BODY} publishing={state.publishing} onPublish={publish} />

      {state.publishError !== null && (
        <PublishErrorBanner
          error={state.publishError}
          onRetry={retryPublish}
          onDismiss={dismissPublishError}
        />
      )}

      {state.status === 'error' && state.error !== null ? (
        <ErrorState error={state.error} onRetry={() => void load()} />
      ) : showInitialLoading ? (
        <LoadingState />
      ) : showEmpty ? (
        <EmptyState />
      ) : (
        <>
          <TimelineList posts={state.items} pending={state.pending} client={client} />
          <div className="load-more">
            {state.loadMoreError !== null && (
              <ErrorState error={state.loadMoreError} onRetry={() => void loadMore()} />
            )}
            {state.nextCursor !== null ? (
              <button type="button" onClick={() => void loadMore()} disabled={state.loadingMore}>
                {state.loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : (
              <p className="timeline__end">You are all caught up.</p>
            )}
          </div>
        </>
      )}
    </main>
  )
}
