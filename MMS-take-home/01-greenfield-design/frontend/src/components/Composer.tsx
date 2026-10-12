import { useState } from 'react'

export interface ComposerProps {
  maxLength: number
  publishing: boolean
  onPublish: (body: string) => void
}

/**
 * Post composer. Body length is bounded by the contract's 1..500 character rule (section 5.1).
 * On submit the draft clears immediately: the new post is shown optimistically by the reducer.
 */
export function Composer({ maxLength, publishing, onPublish }: ComposerProps) {
  const [body, setBody] = useState('')
  const trimmed = body.trim()
  const canPublish = trimmed.length > 0 && trimmed.length <= maxLength && !publishing

  function submit(): void {
    if (!canPublish) {
      return
    }
    onPublish(trimmed)
    setBody('')
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        className="composer__input"
        aria-label="Post body"
        placeholder="What's happening?"
        rows={3}
        maxLength={maxLength}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="composer__row">
        <span className="composer__count">
          {trimmed.length}/{maxLength}
        </span>
        <button type="submit" disabled={!canPublish}>
          {publishing ? 'Publishing…' : 'Post'}
        </button>
      </div>
    </form>
  )
}
