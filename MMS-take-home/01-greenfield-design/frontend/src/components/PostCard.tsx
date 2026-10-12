import { useState } from 'react'
import type { ChirpClient } from '../api/client'
import type { Post } from '../api/types'
import { formatTimelineTime } from '../lib/format'
import { RevisionHistory } from './RevisionHistory'

export interface PostCardProps {
  post: Post
  client: ChirpClient
}

/**
 * One post. Body is rendered as escaped plain text (section 9). The edited indicator and the
 * on-demand revision history are the frontend half of the edit-history design (decision record 2).
 */
export function PostCard({ post, client }: PostCardProps) {
  const [showHistory, setShowHistory] = useState(false)
  const media = post.media

  return (
    <article className="post">
      <header className="post__head">
        <img className="post__avatar" src={post.author.avatar_url} alt="" width={40} height={40} />
        <div className="post__author">
          <span className="post__name">{post.author.display_name}</span>
          <span className="post__handle">@{post.author.handle}</span>
        </div>
        <time className="post__time" dateTime={post.created_at}>
          {formatTimelineTime(post.created_at)}
        </time>
      </header>

      <p className="post__body">{post.body}</p>

      {media !== null &&
        (media.status === 'ready' ? (
          <img
            className="post__media"
            src={media.medium_url}
            alt=""
            width={media.width}
            height={media.height}
          />
        ) : (
          <p className="post__media-status">Image {media.status}.</p>
        ))}

      <footer className="post__foot">
        {post.edited && (
          <span className="post__edited">
            Edited
            {post.edited_at !== null ? ` · ${formatTimelineTime(post.edited_at)}` : ''}
          </span>
        )}
        <a className="post__permalink" href={post.permalink}>
          Permalink
        </a>
        {post.edited && (
          <button
            type="button"
            className="post__history-toggle"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            {showHistory ? 'Hide edit history' : 'Edit history'}
          </button>
        )}
      </footer>

      {showHistory && <RevisionHistory postId={post.post_id} client={client} />}
    </article>
  )
}
