import type { ChirpClient } from '../api/client'
import type { Post } from '../api/types'
import type { OptimisticPost } from '../state/timelineReducer'
import { PostCard } from './PostCard'

export interface TimelineListProps {
  posts: Post[]
  pending: OptimisticPost[]
  client: ChirpClient
}

/** Pending (optimistic) posts render first, then the server-confirmed items in timeline order. */
export function TimelineList({ posts, pending, client }: TimelineListProps) {
  return (
    <ul className="timeline">
      {pending.map((item) => (
        <li key={item.clientId} className="post post--pending">
          <p className="post__body">{item.body}</p>
          <p className="post__pending">Posting…</p>
        </li>
      ))}
      {posts.map((post) => (
        <li key={post.post_id}>
          <PostCard post={post} client={client} />
        </li>
      ))}
    </ul>
  )
}
