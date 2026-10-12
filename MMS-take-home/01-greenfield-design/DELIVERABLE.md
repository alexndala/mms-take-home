# Problem 1 deliverable: Chirp

All sections completed. Numbers are those given in PROMPT.md; every assumed figure is stated where it is used and summarised in section 1. Arithmetic is shown, not asserted.



---

## 1. Use cases and scope

Use cases, in priority order. The ordering is load-driven, not feature-driven: the top two are
where the traffic is and where I spend the engineering effort.

1. **Read the home timeline.** The dominant read. Optimised hardest (section 7).
2. **Publish a post**, with or without one image. The dominant write and the root of fanout.
3. **Search the public corpus.** Freshness-critical (5 s), read-heavy.
4. **Edit a post inside the 15 minute window**, and read the edit history.
5. **Follow / unfollow an account.**
6. **Delete an account**, and purge its posts from every timeline within 24 hours.

Deliberately excluded, per the prompt: direct messages, notifications, trending topics,
advertising, recommendation ranking, and the follow graph's own storage design beyond what the
timeline needs. Moderation is out of scope as a policy; I note only where the hook belongs — an
asynchronous scan stage on the publish path between ingest and fanout (section 4, Media and Publish
Ingest), so that a moderation verdict can suppress fanout without changing the API.

---



### Assumptions the prompt did not settle

Every figure below is mine. Each is used in section 2 with its working shown.

| Assumption | Value I chose | Why |
|------------|---------------|-----|
| Peak-to-average multiplier | 3x | Social traffic has a strong diurnal peak and event spikes; 3x is the working headroom, and section 7 says what absorbs it. |
| Share of posts carrying an image | 15% | Microblog image rates run roughly 10–25%; 15% is mid-range and conservative on egress. |
| Avg original image size | 1.5 MB | The cap is 2 MB; most camera uploads land under it. Using the cap would over-state media by ~33%. |
| Rendered renditions | 3 (thumb 30 KB, medium 150 KB, full 600 KB) + original | A feed needs thumb/medium; the original is the edit/retrieval master. |
| Avg post body length | 400 characters (~400 bytes) | The cap is 500; most posts are shorter. Used for body storage, not for the cap. |
| Avg followees per active user | 200 | Needed to size the read-time merge for pulled (celebrity) posts. |
| Timeline retention | Last 800 entries per user | Bounds materialised-timeline storage to a steady state rather than a monthly growth line (section 2). |
| Edit incidence | 5% of posts, avg 1.5 stored revisions each | Drives (negligible) edit-history storage. |
| Account deletions | 100,000 per month (~3,300/day) | 0.5% of accounts per month; drives purge throughput, not steady state. |
| Search queries | 0.5 per user per day | Small relative to timeline reads. |
| Read-to-write ratio | See section 2 | Stated explicitly, dual-framed, cross-checked. |
| Fanout / pull threshold | 10,000 followers | The push/pull boundary; justified in decision record 1. |


---

## 2. Capacity estimation

### 2.1 Write rate

```
average posts/s = 50,000,000 / 86,400 = 578.7 ≈ 579 posts/s
peak posts/s    = 579 × 3 (peak multiplier, section 1) = 1,737 posts/s
```

### 2.2 Fanout writes at the average fanout

```
average fanout writes/s = 579 × 50                    = 28,935 ≈ 29k writes/s
peak fanout writes/s    = 1,737 × 50                  = 86,850 ≈ 87k writes/s
daily fanout writes     = 50,000,000 × 50             = 2.5B writes/day
```

29k writes/s average is well inside a single wide-column cluster. **The average is not the
problem.**

### 2.3 The skew case (this is the problem)

```
accounts in the top 0.1%        = 20,000,000 × 0.001         = 20,000 accounts
minimum follower edges from them = 20,000 × 1,000,000        = 2.0 × 10^10 = 20 billion edges
cost of ONE post from such account =                 >= 1,000,000 timeline writes, in one burst
```

At one post per day per celebrity:

```
celebrity fanout writes/day = 20,000 × 1,000,000 = 20B/day
celebrity fanout writes/s   = 20,000,000,000 / 86,400 ≈ 231,481 writes/s
```

At the pack's implied per-user posting rate (`50,000,000 / 20,000,000 = 2.5 posts/user/day`):

```
celebrity fanout writes/s = 20,000 × 2.5 × 1,000,000 / 86,400 ≈ 578,704 writes/s
```

That is **8x to 20x** the average fanout path, produced by **0.04% of posts**. A write-time push
for these accounts is a self-inflicted denial of service: one celebrity post spawns >1M writes
against 87k/s of provisioned headroom and starves every other producer. This single result forces
the hybrid fanout in decision record 1.

### 2.4 Constraint tension: "average fanout 50" cannot be an arithmetic mean

The two figures do not reconcile. Proof by the average itself:

```
fanout writes implied by the average = 50,000,000 posts/day × 50 = 2.5B writes/day
fanout writes implied by the floor   = 20,000 celebs  × 1M followers, >= 20B writes/day
```

The celebrity **floor alone** is at least `20B / 2.5B = 8x` the total the average permits. If `50`
were the arithmetic mean over posts, the celebrity population could not exist. Therefore:

> **Reading I adopt:** `50` is the **median (typical) fanout of the bulk corpus**. The top 0.1% is a
> distinct, heavier-tailed regime, not an input to that mean. This is the only reading under which
> both figures hold, and it is the reading the hybrid design is built on.

A corollary worth naming: `50M posts / 20M users = 2.5 posts/user/day` is high for a microblog, so
the write side is unusually hot relative to a typical feed product; it reinforces caching the read
path hard rather than assuming a lower write rate.

### 2.5 Storage per month

Treating each store separately. Redundancy is stated but not folded into the "logical" figures.

**Post bodies.** Assumed average body 400 B (section 1):

```
50M posts/day × 400 B = 20 GB/day → ×30 = 600 GB/month logical
with replication factor 3                      ≈ 1.8 TB/month on disk
```

**Images.** 15% of posts, avg original 1.5 MB, plus three renditions:

```
images/day          = 50M × 0.15 = 7.5M images/day
originals/day       = 7.5M × 1.5 MB   = 11.25 TB/day
renditions/day      = 7.5M × (30KB+150KB+600KB) = 7.5M × 780KB = 5.85 TB/day
media total/day     = 11.25 + 5.85 = 17.1 TB/day → ×30 ≈ 513 TB/month logical
with erasure/object-store redundancy (~1.5x)    ≈ 770 TB/month
```

Media dominates storage by roughly three orders of magnitude over text. This is why media lives in
object storage with a lifecycle policy, never in the primary datastore.

**Edit history.** 5% edited, 1.5 stored revisions each:

```
edited posts/day = 50M × 0.05 = 2.5M
revision bytes   = 2.5M × 1.5 × 400 B = 1.5 GB/day → ×30 ≈ 45 GB/month
```

Negligible. It is why revision history can be stored as **full snapshots** rather than deltas
(decision record 2), avoiding delta-chain reconstruction complexity for no meaningful saving.

**Materialised timelines.** Entry logical size ~64 B (`post_id` 8 + `author_id` 8 + `created_at` 8 +
row/key overhead ~40). Bounded by retention, so this is a steady state, not a monthly line:

```
ingress if all fanout were pushed = 2.5B entries/day × 64 B = 160 GB/day
steady state = 20M users × 800 retained entries × 64 B = 16B entries × 64 B ≈ 1.0 TB
with replication factor 3 ≈ 3.1 TB on disk (steady state)
```

The hybrid removes the celebrity share of the 2.5B/day from this path entirely, so real ingress is
below 160 GB/day. Retention, not traffic, sets the ceiling.

**Search index.** ~1 KB per document (body + metadata + inverted terms):

```
50M docs/day × 1 KB = 50 GB/day → ×30 = 1.5 TB/month logical
with 2 replicas (3 copies)           ≈ 4.5 TB/month on disk
```

### 2.6 Read-to-write ratio — stated explicitly, dual-framed

A timeline *request* hydrates a page of up to 20 posts, so **request ratio** and **content ratio**
differ by roughly 20x. Both are stated because replication and cache sizing follow the request
rate, while CDN and byte egress follow the content rate.

Cross-check against per-user behaviour (20M DAU), assumed per user per day:
20 timeline page loads (the app refreshes on open and on scroll), 3 single-post reads,
0.5 searches, 1 profile view.

```
reads/day  = 20M × (20 + 3 + 0.5 + 1) = 20M × 24.5 = 490M requests/day
reads/s    = 490,000,000 / 86,400 ≈ 5,671 requests/s average
peak       = 5,671 × 3 ≈ 17,014 requests/s
request RPS ratio = 490M / 50M ≈ 9.8 : 1  → I state this as ~10:1
```

Cross-check on the other axis, content reads (post impressions):

```
timeline impressions/day = 490M requests × (20/24.5 timeline share) × 20 posts ≈ 8.0B
+ 60M single-post reads
content ratio ≈ (8.0B + 0.06B) / 50M ≈ 161 : 1  → I state this as ~160–200:1
sanity: 8.06B impressions / 20M users = 403 impressions/user/day
        ≈ one post every 2.4 minutes over a 16h day — plausible for a feed
        and 8.06B / 50M posts = each post seen ~161 times — plausible at 50 median followers
        only if followers resample; I do not rely on the exact figure, only its order of magnitude.
```

**Adopted: ~10:1 at request granularity (≈5.7k reads/s, 17k/s peak) and ~160:1 at content
granularity.** The request ratio sizes replicas and connection pools; the content ratio sizes
caches and CDN.

### 2.7 Egress bandwidth for images, and what it implies for caching

Each rendered page shows 20 posts; assumed 30% carry an image in-feed, served as the 150 KB medium
rendition:

```
images/s  = 5,671 page loads/s × 6 images = 34,026 images/s
egress   = 34,026 × 150 KB ≈ 5.1 GB/s ≈ 440 TB/day
peak     = ×3 ≈ 15.3 GB/s
```

440 TB/day from origin is not purchasable at any sane price. **This forces a CDN**: at a 95% edge
hit ratio the origin sees ~0.26 GB/s average (0.77 GB/s peak), which is serviceable. The cache
policy that produces that hit ratio is in decision record 5 (content-addressed keys, immutable
renditions, long edge TTLs, only originals made mutable).



## 3. High-level design and diagram

One diagram, in a Mermaid fenced code block, showing components and the direction of data flow.
Then prose that walks the write path and the read path.

The diagram and the prose must agree. So must the diagram and section 4.

## 3. High-level design and diagram

```mermaid
graph LR
  Client[Web / Mobile Client]
  CDN[CDN Edge]
  GW[API Gateway + Load Balancer]
  Auth[Auth Service]
  Publish[Publish Service]
  Media[Media Service]
  S3[(Object Store - S3)]
  PostStore[(Post + Revision Store)]
  IdSvc[ID Service - Snowflake]
  Kafka[[Kafka - posts topic]]
  Fanout[Fanout Service]
  Workers[Fanout Workers]
  TLStore[(Timeline Store - ScyllaDB)]
  Redis[(Redis - timeline/post/celebrity cache)]
  Follow[(Follow Graph Store)]
  Indexer[Search Indexer]
  OSearch[(OpenSearch)]
  SearchSvc[Search Service]
  TL[Timeline Service]
  Purge[Purge Service]
  Client --> CDN
  Client --> GW
  Client -- presigned PUT --> S3
  CDN --> S3
  GW --> Auth
  GW --> Publish
  GW --> TL
  GW --> SearchSvc
  Publish --> IdSvc
  Publish --> PostStore
  Publish --> Kafka
  Publish -. validate media .-> Media
  Media --> S3
  Kafka --> Fanout
  Kafka --> Indexer
  Fanout --> Follow
  Fanout --> Workers
  Fanout --> Redis
  Workers --> TLStore
  TL --> Redis
  TL --> TLStore
  TL --> PostStore
  TL --> Follow
  Indexer --> OSearch
  SearchSvc --> OSearch
  Purge --> PostStore
  Purge --> TLStore
  Purge --> OSearch
  Purge --> Redis
  Purge --> S3
```

### Write path

1. Client requests a presigned URL from **Media Service** if the post carries an image, and `PUT`s
   the bytes directly to **S3**. The API tier never proxies image bytes.
2. Client calls `POST /posts` through the **API Gateway**, which authenticates at the edge and
   forwards to **Publish Service**.
3. Publish Service allocates a Snowflake `post_id` from **ID Service**, writes the post row and
   `revision 1` to **Post + Revision Store**, and records the idempotency key. This is the only
   synchronous durable write on the publish path.
4. Publish Service appends one `post.created` event to the Kafka **posts topic** and returns `201`
   with the `Post`. The event, not the response, is what drives fanout and indexing.
5. **Fanout Service** consumes the topic. It reads the author's follower count from **Follow Graph
   Store**:
   - **ordinary author (≤ 10,000 followers):** it expands the post to follower ids and hands
     batched inserts to **Fanout Workers**, which append `(viewer_id, created_at, post_id,
     author_id)` rows to the **Timeline Store** and refresh the corresponding **Redis** timeline
     caches.
   - **celebrity author (> 10,000 followers):** it does **no** per-follower write. It appends the
     post to the author's **celebrity list** in Redis and in the Timeline Store under an author key.
     Followers merge these at read time.
6. **Search Indexer** consumes the same topic and upserts the document into **OpenSearch**. One
   topic, two independent consumers, both idempotent.

### Read path (home timeline)

1. Client calls `GET /timelines/home` via the Gateway → **Timeline Service**.
2. Timeline Service fetches the viewer's materialised entries: **Redis** on hit, **Timeline Store**
   on miss (which also repopulates the cache).
3. It fetches the viewer's **pull list** — the celebrities this viewer follows — from a cached
   per-viewer follow-graph projection.
4. It merges the pushed entries with the celebrities' recent posts, both keyed by
   `(created_at, post_id)` and bounded by the requested cursor, to a single ordered page.
5. It hydrates the `post_id`s to `Post` objects with a batched multiget against the **Redis** post
   cache, falling through to **Post + Revision Store**. Tombstoned/deleted ids are dropped here.
6. It returns `{ items, next_cursor }` matching section 5.

The edit and delete paths and the purge are described in decision records 2 and 4 and traced in
section 12.

## 4. Core components

Each entry: responsibility, what it stores/caches, how it scales, behaviour when unavailable.

**API Gateway + Load Balancer.** Terminates TLS, validates the JWT at the edge (signature + `jti`
denylist check), enforces coarse per-`sub`/per-IP rate limits, routes to services. Scales
horizontally, stateless. Unavailable: total outage at the edge; mitigated by anycast and N+2
replicas across zones.

**Auth Service.** Issues and rotates tokens, owns login and refresh. Stores refresh families
(hashed) in its own relational store and the access-token denylist in Redis. Scales horizontally.
Unavailable: existing access tokens keep working for up to 15 minutes; no new logins or refreshes,
which is a degraded-but-usable state.

**Publish Service.** Validates the write, allocates ids, persists the post + first revision,
records idempotency, emits the Kafka event. Stores nothing hot itself. Scales horizontally on the
write rate (579/s avg, 1,737/s peak). Unavailable: publishes fail with `503`; the client retries
with the same idempotency key, so no duplicate on recovery.

**ID Service (Snowflake).** Hands out time-ordered 64-bit ids (`post_id`, etc.). Because ids are
time-ordered, `post_id` is a usable tiebreaker and range cursor. Scales as a partitioned sequence
allocator; workers lease id ranges so a single unavailable node does not stop allocation.

**Post + Revision Store.** System of record for post bodies and full revision snapshots.
Wide-column, partitioned by `post_id`, with an `author_id` secondary index for purge and profile
reads. Written at 579/s, read at the content rate via cache. Unavailable: writes fail; reads are
served from the Redis post cache for hot posts and fail otherwise. Failover in section 8.

**Timeline Store (ScyllaDB).** Materialised push timelines, partitioned by `viewer_id`, clustered by
`(created_at DESC, post_id)`. Written at up to ~29k/s average and ~87k/s peak (fanout). Scales by
adding nodes; partitioning spreads viewers evenly. Retention 800 entries/reader keeps it at ~1 TB
steady state. Unavailable: timeline reads for cache-miss users fail or return stale cache; section 8.

**Fanout Service + Workers.** Consume `post.created`, decide push vs pull, expand followers, batch
writes. Scale as independent consumer-group members; the queue absorbs bursts, which is what makes
the celebrity case survivable. Workers are idempotent (upsert on `(viewer_id, post_id)`). Worker
death mid-post: the Kafka offset is not committed, so the event is redelivered; see section 8.

**Redis (timeline + post + celebrity cache).** Three logical caches: recent timeline pages per
viewer (short TTL), post objects by `post_id` (TTL, invalidated on edit), and per-author celebrity
lists. Scales by sharding on key. Unavailable: hit rate collapses to the Timeline Store and Post
Store; request coalescing prevents a stampede; latency rises but the system stays up.

**Follow Graph Store.** Adjacency in both directions (`follows_by_follower`, `follows_by_followee`).
The follower→followee direction feeds fanout; the followee→follower direction feeds pull-list
construction and purge. Partitioned by the leading id. Unavailable: fanout pauses (queue buffers)
and pull-list construction degrades; see section 8.

**Media Service + S3 + CDN.** Issues presigned uploads, validates content type/size, runs
scan + re-encode + rendition generation asynchronously, stores originals and renditions in S3, serves
via CDN. Scales as a stateless service; S3/CDN scale inherently. Media Service unavailable: uploads
fail but text-only publishes proceed. S3 unavailable on publish: publish is accepted with
`media.status = "processing"` and the rendition completes on retry (section 8).

**Search Service + Indexer + OpenSearch.** The Indexer consumes the same `posts` topic; Search
Service serves queries. Documents keyed by `post_id`, indexed on body with `created_at` for recency sort.
Scales by index sharding and consumer count. Indexer behind: search freshness breaches SLO but the
rest of the system is unaffected; lag is the alert (section 10).

**Purge Service.** Executes account deletion: logically via tombstones first (immediate read-time
hiding) then physically purges Timeline Store entries, posts, revisions, search docs, caches and S3
objects within 24h. Scales by sharding deletion jobs. Unavailable/failed halfway: jobs are
resumable and idempotent; read-time filtering already hides the content, so the deadline is the only
residual risk.


## 5. API contract

Base URL `https://api.chirp.example/v1`. JSON request and response bodies. All authenticated calls
carry `Authorization: Bearer <access_token>`. Times are RFC 3339 UTC. Identifiers are opaque
strings (`u_…`, `p_…`, `m_…`) — Snowflake-backed but not parsed by clients.

### 5.1 Endpoints

**Publish a post**

```
POST /posts
Headers: Authorization, Idempotency-Key: <uuid>, Content-Type: application/json
Body:    { "body": "string, 1..500 chars", "media_id": "m_…" | null }
201 ->   Post
```
Status codes: `201` created · `400` malformed JSON · `401` missing/expired token · `403`
suspended account · `409` idempotency key reused with a different body · `413` body over 500 chars
or media over 2 MB · `422` referenced media not uploaded/valid · `429` rate limited · `503`
publish path shedding.

**Read home timeline**

```
GET /timelines/home?limit=20&cursor=<opaque>
200 -> { "items": [Post], "next_cursor": "string" | null, "generated_at": "…" }
```
`limit` default 20, max 50. `cursor` absent means "head" (newest). Status: `200` · `400` bad
cursor/limit · `401` · `429`.

**Read a single post**

```
GET /posts/{post_id}
200 -> Post
```
`404` unknown or author-deleted · `410` purged and gone permanently · `401` · `429`.

**Edit a post (inside the 15 minute window)**

```
PATCH /posts/{post_id}
Headers: Authorization, If-Match: <revision>
Body:    { "body": "string, 1..500 chars" }
200 ->   Post   (revision incremented, "edited": true, "edited_at" set)
```
Status: `200` · `403` not the author · `404` · `409` edit window closed (past published_at + 15 min)
· `412` `If-Match` revision is stale (someone edited first) · `413`/`422` invalid body · `429`.

**Read a post's edit history**

```
GET /posts/{post_id}/revisions?limit=20&cursor=<opaque>
200 -> { "items": [Revision], "next_cursor": "string" | null }
```
Revisions returned newest-first. Status: `200` · `404` · `401` · `429`.

**Search the public corpus**

```
GET /search?q=<query>&limit=20&cursor=<opaque>&sort=recent
200 -> { "items": [Post], "next_cursor": "string" | null, "took_ms": 12 }
```
`q` required (1..200 chars after trim). `sort` defaults to `recent` precisely so the 5 s freshness
SLO is observable; `relevance` is allowed but ranked search is otherwise out of scope. Status: `200`
· `400` missing/empty `q` · `401` · `429`.

**Follow / unfollow**

```
POST   /follows/{user_id}     204   (idempotent: following an already-followed account is 204)
DELETE /follows/{user_id}     204   (idempotent)
```
Status: `204` · `403` self-follow/blocked · `404` unknown user · `401` · `429`.

**Delete an account**

```
DELETE /accounts/me
202 -> { "deletion_id": "d_…", "purge_deadline": "…Z", "received_at": "…Z" }
```
Asynchronous. `purge_deadline` is `received_at + 24h` and is the SLO promise. Status: `202` ·
`401` · `429`.

**Media upload (two-step, because the image can exceed any sane request body and must not transit
the API tier)**

```
POST /media
Body: { "content_type": "image/jpeg", "size_bytes": 1572864 }
201 ->{ "media_id": "m_…", "upload_url": "https://…presigned…", "expires_at": "…Z" }
POST /media/{media_id}/complete
202 ->{ "media_id": "m_…", "status": "processing" | "ready" | "blocked" }
```
`POST /media` rejects a non-allowlisted content type or `size_bytes > 2_097_152` with `422`/`413`.
The client `PUT`s bytes to `upload_url` out of band. Publish may reference a `media_id` that is
`processing`; the post's `media.status` then transitions to `ready` (or `blocked`) asynchronously.

**Shared object schemas** (these are the types the frontend compiles against):

```jsonc
// Post
{
  "post_id":   "p_01JBCHIRP0000000000000001",
  "author": {
    "user_id":      "u_01JBCHIRP0000000000000009",
    "handle":       "ada",
    "display_name": "Ada L.",
    "avatar_url":   "https://cdn.chirp.example/avatars/u_…/thumb.jpg"
  },
  "body":       "hello, timeline",
  "created_at": "2026-10-10T21:00:00Z",
  "edited":     true,
  "edited_at":  "2026-10-10T21:10:00Z",
  "revision":   2,
  "media": {
    "media_id":  "m_01JBCHIRP0000000000000007",
    "type":      "image",
    "status":    "ready",
    "thumb_url":  "https://cdn.chirp.example/m/…/thumb.jpg",
    "medium_url": "https://cdn.chirp.example/m/…/medium.jpg",
    "full_url":   "https://cdn.chirp.example/m/…/full.jpg",
    "width":  1200,
    "height": 800
  },
  "permalink": "https://chirp.example/p/p_01JBCHIRP0000000000000001"
}

// Revision
{
  "revision":  1,
  "body":      "hello, timelines",
  "editor_id": "u_01JBCHIRP0000000000000009",
  "edited_at": "2026-10-10T21:10:00Z"
}
```

`media` is `null` when the post has no image. `edited` is `false` and `edited_at` is `null` on an
unedited post; `revision` starts at `1` on publish and increments per edit.

### 5.2 Authentication and authorisation

- **Scheme:** OAuth 2.1 / OIDC. Access token is a JWT (RS256), lifetime **15 minutes**, claims
  `sub` (user_id), `scope`, `exp`, `jti`.
- **Where the credential lives:** `Authorization: Bearer` header, never a query parameter or a
  cookie. The browser frontend holds the access token in memory only; the refresh token is an
  opaque, rotating, server-stored value (httpOnly cookie on the web app).
- **Refresh:** opaque refresh token, 30 day idle lifetime, rotated on every use; reuse of a rotated
  token invalidates the family.
- **Revocation:** the 15 minute access TTL bounds the worst case, but account deletion and
  "log out everywhere" need to be immediate, so the `jti` is added to a Redis denylist for the
  remainder of its life. Refresh-family deletion is the primary revocation; the denylist closes the
  short window.
- **Authorisation:** edit requires `sub == post.author_id` **and** `now <= published_at + 15 min`;
  account deletion only for `self`; rate limits keyed on `sub`.

### 5.3 Pagination

**Mechanism: opaque keyset cursor**, `base64url(created_at_epoch_ms ":" post_id)`. Sort is
`(created_at DESC, post_id DESC)`, so the cursor is a total order key with no ties.

**Why not offset:** the home timeline is a merge of continuously appended streams. With
`OFFSET`, a single new post at the head shifts every subsequent offset, so page 2 can repeat an item
from page 1 and silently drop another. Keyset cursors are immune because they are anchored to a
value, not a count. Relevance-sorted search uses the same envelope but carries the backend's sort
key in the cursor.

**New posts arriving mid-page:** they are **not injected** into an in-flight sequence. Page N+1
returns only items strictly older than the cursor, so a single scroll never duplicates or skips an
item. New posts are surfaced by a fresh head request (no cursor) and rendered as a "show N new
posts" affordance, which resets pagination to the new head.

### 5.4 Idempotency

| Operation | Idempotent? | Mechanism |
|-----------|-------------|-----------|
| Publish | No (would duplicate) | Client `Idempotency-Key` (UUIDv4). Server stores `key -> post_id` for 24h; a replay returns the original `201` and `Post`. Same key + different body → `409`. |
| Edit | No (append semantics) | Guarded by `If-Match: <revision>`. Safe retry: same revision + same content → `200`; same revision after it moved → `412`. |
| Follow / Unfollow | Yes (state convergence) | Last-writer-wins on the graph edge; always `204`. |
| Delete account | Yes | Replay returns the same `deletion_id` and `202`. |
| Media complete | Yes | Completing an already-complete media returns the same status. |

**Safe retry of a publish:** client generates the key once per user intent, retries the identical
request with exponential backoff on `429`/`5xx`, and never generates a new key for the same logical
post. If the client lost the response, the replay returns the created post; the client reconciles by
`post_id` and does not create a second post.

### 5.5 Error model

Single shape, always non-2xx on failure:

```json
{
  "error": {
    "code": "EDIT_WINDOW_CLOSED",
    "message": "This post can no longer be edited.",
    "retryable": false,
    "request_id": "req_4f2a…",
    "details": { "post_id": "p_01J…", "editable_until": "2026-10-10T21:15:00Z" }
  }
}
```

| Status | Meaning in Chirp | Retryable |
|--------|------------------|-----------|
| 400 | malformed request / bad cursor | No |
| 401 | token missing, expired or revoked | No (refresh, then retry once) |
| 403 | authenticated but not permitted (not author, suspended) | No |
| 404 | resource unknown, or author-deleted | No |
| 409 | state conflict (edit window closed, idempotency mismatch) | No |
| 410 | post purged permanently | No |
| 412 | `If-Match` precondition failed (stale revision) | No (re-fetch, then decide) |
| 413 | payload too large | No |
| 422 | semantically invalid (media not ready, bad content type) | No |
| 429 | rate limited | **Yes** (honour `Retry-After`) |
| 500 / 502 / 503 / 504 | server-side; `503` also signals publish shedding | **Yes** (bounded backoff) |

`retryable` is set by the server and is authoritative; the frontend must render from `error.code`
and `error.message`, not from a status-code guess. A failed write **never** returns `200`.

**The frontend in `frontend/` implements exactly this contract**, including the error shape and the
cursor envelope.

## 6. Data model

Keys are chosen from the access patterns in section 5, not from normal form. Every table states its
partition key and why the hot read or write lands on a single partition.

### 6.1 Post (Post + Revision Store, wide-column)

| Field | Notes |
|-------|-------|
| `post_id` | **partition key**, Snowflake, time-ordered |
| `author_id` | secondary (materialised) index for profile listing and purge |
| `body` | current body, ≤ 500 chars |
| `created_at` | publish time; the cursor sort key |
| `revision` | current revision number, starts at 1 |
| `edited` / `edited_at` | null until first edit |
| `media_id` | null, or FK to Media |
| `state` | `live` or `tombstoned` |

**Partition by `post_id`.** The dominant access is point hydration by `post_id` (timeline and search
both return ids that are then batched). Time-ordered ids mean range scans by `post_id` are also
roughly range scans by time. Listing a user's posts is served by the `author_id` index, which is a
secondary path and is used by purge, not by the hot read.

### 6.2 PostRevision (full snapshots)

| Field | Notes |
|-------|-------|
| `post_id` | **partition key** |
| `revision` | **clustering key**, DESC |
| `body`, `editor_id`, `edited_at` | snapshot of that revision |

**Partition by `post_id`, cluster by `revision`.** Reading edit history is "all revisions for one
post, newest first". Full snapshots (not deltas) because section 2.5 shows history is ~45 GB/month —
delta-chain reconstruction would buy nothing and complicate the read. The 15 minute window plus an
edit rate limit bounds the partition.

### 6.3 Timeline entry (materialised push timeline, ScyllaDB)

| Field | Notes |
|-------|-------|
| `viewer_id` | **partition key** |
| `created_at` | **clustering key**, DESC |
| `post_id` | **clustering key**, DESC (tiebreak) |
| `author_id` | needed for read-time tombstone filtering |
| TTL | retention, 800 entries/user |

**Partition by `viewer_id`.** The hot read is "one viewer's page in time order", which is exactly one
partition, already sorted. This is the whole reason for a materialised timeline. The `author_id`
copy is deliberate duplication: it lets the read path drop a deleted author's entries without a
second lookup.

### 6.4 Celebrity list (pull path)

Same shape as 6.3 but **partitioned by `author_id`** and clustered by `(created_at DESC, post_id)`.
This is where posts from accounts above the 10k threshold live instead of being pushed. Two
consequences that pay for the hybrid: (a) followers merge these at read; (b) **deleting a celebrity
account is a single-partition delete**, however many millions of followers it has. Ordinary users
keep an empty celebrity list.

### 6.5 Follow graph (two adjacency tables)

| Table | Partition key | Clustering key | Serves |
|-------|---------------|----------------|--------|
| `follows_by_follower` | `follower_id` | `followee_id` | fanout ("who does X follow"), pull-list build |
| `follows_by_followee` | `followee_id` | `follower_id` | purge, follower counts, pull-list propagation |

Stored both ways because fanout (needs followers-of-author) and pull-list construction (needs
followees-of-viewer) are both hot and are opposite directions. A separate counter table keeps
`follower_count` per account for the push/pull threshold decision. Follow/unfollow writes are
idempotent upserts/deletes on both tables.

### 6.6 Viewer pull list (projection)

`viewer_id` (partition) → set of `followee_id`s that are above threshold. Maintained on
follow/unfollow and when an account crosses the threshold. Read on every timeline request so the
merge knows which celebrity lists to consult; cached in Redis.

### 6.7 Fanout recipients (purge reverse index)

`author_id` (partition), `created_at`, `post_id`, `viewer_id` (clustering). Written by fanout
workers alongside the timeline entry, TTL-matched to timeline retention. It inverts 6.3 so purge can
answer "which viewers received author A's post P" without scanning the timeline table. It is the
one place where the honest cost of the 24h purge guarantee is paid: it roughly doubles fanout write
volume for ordinary authors (bounded, because ordinary fanout ≤ 10k). See decision record 4.

### 6.8 Media

`media_id` (partition), `owner_id` (indexed), `s3_key`, `content_type`, `size_bytes`, `status`
(`processing`/`ready`/`blocked`), rendition keys (thumb/medium/full), `width`, `height`,
`created_at`. S3 is the byte store; this row is metadata and state. Indexed by `owner_id` for purge.

### 6.9 Search document (OpenSearch)

`_id = post_id`; fields `body`, `author_id`, `created_at`, `edited_at`, `revision`. Index sharded by
`hash(post_id)` for even write distribution; a write alias points at the live index, which allows
reindex-by-alias without downtime. Recency sort uses `created_at`; relevance ranking is out of scope.

### 6.10 Idempotency and deletion jobs

- `idempotency_keys`: `key` (partition), `user_id`, `post_id`, `request_hash`, TTL 24h. Powers
  section 5.4.
- `deletion_jobs`: `deletion_id` (partition), `user_id`, `state`, `progress`, `received_at`,
  `purge_deadline`. Resumable and idempotent; section 8 and decision record 4.

### 6.11 Relationships

```
User 1---* Post 1---* PostRevision
Post *---1 Media
User *---* User        (follows, via 6.5)
User 1---1 ViewerPullList
Post 1---* TimelineEntry *---1 User   (viewer)
Post 1---* FanoutRecipient
Post 1---1 SearchDocument
```

## 7. Scaling and bottlenecks

Bottlenecks are named in the order they saturate as load grows, with the load figure at which each
breaks and the response.

**First: the fanout write path (Fanout Workers + Timeline Store).** Provisioned to ~100k writes/s,
which is only ~15% above the `87k/s` peak from section 2.2 — deliberately the tightest resource,
because over-provisioning it means over-paying for the most expensive write amplifier. At sustained
fanout above ~100k/s (roughly 2,000 median-fanout posts/s), Kafka lag grows, the offset of fresh
timelines slips, and home timelines start missing recent posts. Response: scale the consumer group
and Scylla nodes linearly (both shard cleanly by `viewer_id`); if the burst is a celebrity event the
threshold already excludes it, and if it is broad, lower the push threshold to convert more authors
to pull.

**Second: the timeline read path (Redis + Post Store hydration).** At the `17k/s` peak request rate
each page triggers ~20 hydration lookups, so the read path depends entirely on the Redis post cache
(section 6.1). It breaks when a Redis shard saturates or the hit ratio collapses — a cold cache after
a restart or a celebrity churn event. Effect: multigets fall through to the Post Store, p99 climbs,
and a thundering herd compounds it. Response: shard Redis on key, batch multigets, add request
coalescing so one miss per key is fetched, and jitter TTLs.

**Third: search indexing.** Throughput is not the issue (section 2.6, decision record 3); **lag** is.
At sustained ~2× peak ingest the indexer falls behind and the 5 s freshness SLO is breached.
Response: add topic partitions and consumer/worker parallelism, increase bulk batch size, and isolate
reindex traffic from live traffic so a rebuild cannot starve freshness.

**Slower break: media storage and egress.** Growth from `17.1 TB/day` ingress and `~440 TB/day`
egress is a cost and capacity curve, not a latency cliff; it is managed with CDN hit ratio, lifecycle
GC and rendition retention policy rather than horizontal scaling of origin.


## Decision records

### Decision record 1 — Fanout strategy

> **Decision:** Hybrid. Write-time push for authors at or below **10,000 followers**; read-time
> pull/merge for authors above it. The threshold is a tunable, not a constant.
>
> **Alternative rejected:** Pure write-time fanout ("fanout-on-write") for every post. It is the
> simplest timeline read and I rejected it on arithmetic, not taste. Also considered, and rejected
> for the opposite reason, was pure read-time merge for everyone.
>
> **The numbers that forced it:** the average path is cheap — `579 posts/s × 50 = 28,935 writes/s`
> average, `~87k/s` peak, which one ScyllaDB cluster absorbs. The skew path is not. `20,000,000 ×
> 0.001 = 20,000` accounts at `≥1,000,000` followers each is a floor of `20,000,000,000` timeline
> writes/day, versus the `50,000,000 × 50 = 2.5B/day` the average implies — **8× the entire average
> path from 0.04% of posts**, rising to `578,704/s` at the pack's implied 2.5 posts/user/day. A
> single celebrity post is `≥1,000,000` writes in one burst. The 10k threshold caps any single
> pushed post at 10,000 writes, which a Kafka-buffered writer pool can drain.
>
> **What this costs:** two permanent code paths (push writer + read-side merge); the merged read is
> more complex and slightly slower; a per-viewer pull list must be maintained as accounts cross the
> threshold; and the threshold itself is a guess that can be wrong for a rising account.
>
> **What would change my mind:** a measured real post-fanout distribution whose 99.9th percentile is
> below ~5,000 would let me drop the hybrid for pure push and delete the merge path. Conversely, if
> merged-read p99 exceeds 300 ms or the pull list costs more than the fanout it saves, I raise the
> threshold. Specific test: replay one day of posts, measure merged-read p99 and fanout write
> throughput at 2× peak.

### Decision record 2 — Edit propagation

> **Decision:** Timelines store **identifiers** `(post_id, author_id, created_at)`, never post
> content. An edit updates `Post.body/revision/edited_at`, appends a `PostRevision` snapshot,
> invalidates the Redis post-cache key, and emits a search-update event. **Nothing in the timeline
> store is rewritten.**
>
> **Alternative rejected:** Denormalising the body into timeline entries for a cheaper read
> (the classic fanout-of-content timeline). It makes reads marginally faster and makes edits
> catastrophic.
>
> **The numbers that forced it:** the edit window is 15 minutes and the worked-trace author has
> **3,000,000 followers**. With denormalised content, that single edit is up to 3M entry rewrites
> (and under hybrid it is a pulled author, so those entries would not even be individually
> addressable). Even the ordinary case: `50M × 5% = 2.5M` edits/day × 50 fanout = `125M` rewrites/
> day, pure write amplification for no read benefit. The id-based model makes an edit **O(1)** — one
> row, one cache invalidation — and hydration reads the latest revision by construction. Section 2.5
> shows revision history is ~45 GB/month, so storing full snapshots rather than deltas costs nothing
> meaningful.
>
> **What this costs:** read amplification — a page of 20 posts is 20 hydration lookups, which is why
> the Redis post cache and batched multiget exist; a dependency on cache invalidation reliability; a
> short staleness window while invalidation propagates; and **version skew**, where a reader mid-scroll
> can see an older revision of a post than a fresh reader (traced in section 12).
>
> **What would change my mind:** if post-cache hit ratio fell below ~90% and hydration p99 exceeded
> ~150 ms under load, I would keep a short-TTL denormalised copy in the timeline entry with
> asynchronous repair, accepting a bounded staleness to cut round trips. Measurement: post-cache hit
> ratio and hydrated-page p99.

### Decision record 3 — Search freshness

> **Decision:** Asynchronous indexing off the **same Kafka `posts` topic** the fanout service uses.
> The indexer consumes in micro-batches (≤ 500 ms), bulk-upserts into OpenSearch, and targets
> **p99 ≤ 5 s** from publish to searchable.
>
> **Alternative rejected:** Synchronous dual-write — index the document inside the `POST /posts`
> request before returning. It couples search availability to publish latency and to the OpenSearch
> cluster, exactly the coupling the prompt's scope warns against.
>
> **The numbers that forced it:** ingest is `579 docs/s` average and `1,737/s` at 3× peak. A 500 ms
> micro-batch means ~2 batches/s at average load and still ≤ 1 batch/s at peak, so the pipeline has
> roughly **9× margin** against the 5 s SLO before consumer lag even matters. OpenSearch's 1 s
> default refresh plus a sub-second batch keeps publish→searchable well under 5 s. The constraint is
> the SLO, not the throughput, so the queue is the right place for the latency budget.
>
> **What this costs:** search is eventually consistent — a post (or edit, or deletion) can be absent
> or stale in results for up to ~5 s; the index is not the source of truth; ordering of edits and
> deletes must be handled by revision/tombstone, and indexer lag is a new failure mode (section 8).
>
> **What would change my mind:** if indexer lag p99 exceeded 3 s under sustained 2× peak (e.g., a
> bulk reindex competing with live traffic), I would dedicate partitions/consumers to the live topic
> and isolate reindex traffic. Measurement: `publish_to_searchable_seconds` p99 and consumer-group lag.

### Decision record 4 — Deletion purge

> **Decision:** Two-phase. **Phase 0 (immediate):** mark the account deleted and tombstone its
> posts; every read path filters tombstoned authors, so content is unreadable at once. **Phase 1
> (asynchronous, resumable):** physically purge posts, revisions, timeline entries, search docs,
> cache keys and S3 objects, within **24 h**, using the `fanout_recipients` reverse index (section
> 6.7) for ordinary authors and a single-partition delete for celebrity authors.
>
> **Alternative rejected:** Synchronous scatter-delete — block the `DELETE /accounts/me` request
> while every timeline entry is removed. It cannot meet any latency budget and cannot survive a
> partial failure. Also rejected: read-filter only, never physical — it fails the word "purges" and
> leaves PII resident.
>
> **The numbers that forced it:** the budget is **24 h**; deletions are assumed at `100,000/month ≈
> 3,333/day`. An ordinary author has fanout ≤ the **10,000** push threshold, so the reverse index
> targets at most 10k entries per post instead of scanning the **16B-entry** steady-state timeline
> table, which is unscannable. A celebrity's posts live in an **author-partitioned** list, so purging
> a 1M-plus-follower account is one partition delete, not 1M row deletes. Paying for this: the
> reverse index roughly **doubles** ordinary fanout writes (`~29k/s → ~58k/s`).
>
> **What this costs:** tombstones live up to 24 h; the reverse index doubles ordinary fanout write
> volume and adds storage; the purge job is stateful and must be resumable; S3 objects, CDN caches
> and **backups** hold the data longest, so a truly complete purge is bounded by backup rotation,
> which I state rather than hide (section 9).
>
> **What would change my mind:** if the fanout write budget could not absorb the ~2× cost of the
> reverse index, I would fall back to read-filter + retention-TTL eviction and renegotiate what
> "purge" means. Measurement: purge completion p99 must stay under 24 h with a target of 12 h; a load
> test at 5B affected entries exposes it.

### Decision record 5 — Image handling

> **Decision:** Two-step **presigned direct-to-S3 upload** (`POST /media` → client `PUT` → `POST
> /media/{id}/complete`), asynchronous validation/scan/re-encode with EXIF stripped, three
> precomputed renditions (thumb/medium/full), delivery via CDN with **content-addressed, immutable**
> rendition keys and long edge TTLs, lifecycle GC and deletion propagation.
>
> **Alternative rejected:** Proxy the bytes through the API tier and resize on the fly per request.
> It removes the async processing state but puts resize compute and all image egress on the origin.
>
> **The numbers that forced it:** media ingress is `17.1 TB/day` and feed egress is `5,671 pages/s
> × 6 images × 150 KB ≈ 5.1 GB/s = ~440 TB/day`, `15.3 GB/s` at peak. Origin cannot serve 440 TB/day
> at any sane cost; a CDN at a 95% edge hit ratio drops origin to `~0.26 GB/s`. On-the-fly resize
> defeats that: every size variant becomes a distinct origin miss. Content-addressed immutable
> renditions are what make a 95%+ hit ratio achievable. The 2 MB cap and content-type allowlist are
> enforced at URL issuance, before any bytes reach storage.
>
> **What this costs:** a processing window where `media.status = "processing"` and a post can be live
> before its image is ready; rendition storage of ~175 TB/month on top of originals; and deletion is
> harder because CDN edges and immutable objects must be invalidated or aged out (resolved with
> content-addressed keys plus a mutable pointer row that deletion can flip).
>
> **What would change my mind:** a measured median image well under 100 KB would make on-the-fly
> resize viable again. If CDN hit ratio dropped below 90%, I would revisit key strategy and TTLs.
> Measurement: origin egress GB/s and p95 image time-to-first-byte.
>


## 8. Failure modes and reliability

| Failure | What the user sees | Effect | Recovery |
|---------|--------------------|--------|----------|
| Fanout worker dies mid-post | The post is briefly missing from some followers' timelines, then appears | At-least-once: the Kafka offset is not committed until the batch is written, so the event is redelivered | Idempotent upsert on `(viewer_id, post_id)` makes redelivery safe; no user action needed |
| Search indexer falls behind | A just-published post is not findable for longer than 5 s | Search freshness SLO burn; the rest of the system is unaffected | Alert on consumer lag; scale consumers/partitions; replay from the retained topic offset |
| Image store unavailable on publish | Text publishes normally; image posts show a placeholder, or are accepted with `media.status = "processing"` | Publish is decoupled from media availability; only the image is late | Publish accepts the reference, rendition/scan retries with backoff; if upload URLs cannot be issued, text-only publish still succeeds |
| Timeline cache node is lost | Higher latency on timeline reads; possible brief errors for cache-miss users | Hit ratio drops; Post/Timeline Stores absorb direct reads | Cluster replicates/shard-replicates the key space; survivors serve; request coalescing limits the stampede; cache warms from the store |
| Primary datastore fails over | Brief write errors (`503`), stale reads for seconds | In-flight writes fail; reads continue from replicas | Client retries with the same idempotency key; failover to a synchronous standby; stated RPO is near-zero for the Post Store |
| Purge job fails halfway | No visible effect — content was hidden in phase 0 | Physical purge stalls | Jobs are checkpointed and idempotent; resume from checkpoint; read-time tombstones keep content hidden while it retries, within the 24 h budget |

**Consistency model, per read path:**

| Read path | Consistency | Accepted staleness |
|-----------|-------------|--------------------|
| Home timeline (others' posts) | Eventual | Seconds (fanout + cache TTL); a follower may briefly not see a post |
| Own posts in own timeline | Read-your-writes | None — the reader's own posts are merged from the source at read |
| Single post / edit history | Strong for the author; read-your-writes | Others see the new revision within the cache-invalidation window (< TTL, ~seconds) |
| Search | Eventual | ≤ 5 s (SLO) |
| Deletion visibility | Immediate (logical tombstone) | Physical purge ≤ 24 h |
| Pull (celebrity) merge | Eventual | One timeline refresh; a celebrity post may miss the current page and appear on refresh |


## 9. Worked trace

**Scenario:** an author with 3,000,000 followers edits a post 10 minutes after publishing, while
one of its followers is part way through paginating their home timeline.

### Cast, clock and fixed identifiers

| Name | Value |
|------|-------|
| Author (celebrity) | `u_01JNOVA000000000000000001`, handle `nova`, **3,000,000 followers** (> 10,000 threshold → pulled) |
| Follower | `u_01JKAI000000000000000002`, handle `kai`; follows `nova` among ~200 accounts |
| Post | `p_01JPC00000000000000000001` |
| Revisions | `1` at publish, `2` after the edit |
| Publish idempotency key | `idem_9c1f0a7e-2b6d-4c11-9f3a-0f2e7a1c4b55` |
| `T0` publish | `2026-10-10T21:00:00Z` (`1791666000000` ms) |
| Edit deadline | `2026-10-10T21:15:00Z` (`T0 + 15 min`) |
| `T0+9m` page 1 | `2026-10-10T21:09:00Z` |
| `T0+10m` edit | `2026-10-10T21:10:00Z` |
| `T0+10m30s` page 2 | `2026-10-10T21:10:30Z` |
| `T0+11m` refresh | `2026-10-10T21:11:00Z` |
| Cursor `C1` | `MTc5MTY2NjAwMDAwMDpwXzAxSlBDMDAwMDAwMDAwMDAwMDAwMDAwMDE` = base64url(`1791666000000:p_01JPC00000000000000000001`) |

`nova` is above the 10k push/pull threshold, so `p_01JPC…001` is **never fanned out** to any of the
3M followers. It lives under `nova`'s author-partitioned celebrity list (section 6.4) and is merged
into a follower's page at read. This is the whole reason the edit below is cheap.

### Step 1 — `nova` publishes (T0)

```http
POST /posts HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…       # sub = u_01JNOVA000000000000000001
Idempotency-Key: idem_9c1f0a7e-2b6d-4c11-9f3a-0f2e7a1c4b55
Content-Type: application/json

{ "body": "morning all - shipping day", "media_id": null }
```

```http
HTTP/1.1 201 Created
{
  "post_id": "p_01JPC00000000000000000001",
  "author": { "user_id": "u_01JNOVA000000000000000001", "handle": "nova",
              "display_name": "Nova", "avatar_url": "https://cdn.chirp.example/avatars/…" },
  "body": "morning all - shipping day",
  "created_at": "2026-10-10T21:00:00Z",
  "edited": false, "edited_at": null, "revision": 1, "media": null,
  "permalink": "https://chirp.example/p/p_01JPC00000000000000000001"
}
```

State after step 1:

| Component | State |
|-----------|-------|
| ID Service | issued `p_01JPC…001` (time-ordered) |
| Post + Revision Store | post row `p_01JPC…001` (body v1, revision 1); revision row `(p_01JPC…001, 1)` |
| Idempotency store | `idem_9c1f… → p_01JPC…001`, TTL 24h |
| Kafka `posts` | one `post.created` event (offset o) |
| Fanout Service | consumed event; `follower_count(nova)=3,000,000 > 10,000` → **no expansion** |
| Celebrity list (Redis + store) | appended `(nova, 21:00:00Z, p_01JPC…001)` |
| Timeline Store (push) | unchanged — no `viewer_id` rows written |
| Search | not yet indexed (step 2) |

### Step 2 — search becomes fresh (≤ 21:00:05)

The Search Indexer consumes the same event in the next ≤500 ms micro-batch and upserts the document
`_id = p_01JPC…001`. `publish_to_searchable` ≈ 0.5 s, inside the 5 s SLO.

### Step 3 — `kai` reads page 1 (T0+9m = 21:09:00)

```http
GET /timelines/home?limit=20 HTTP/1.1
Authorization: Bearer eyJ…                        # sub = u_01JKAI000000000000000002
```

```http
HTTP/1.1 200 OK
{
  "items": [ /* 19 pushed posts from ordinary followees… */ ,
    { "post_id": "p_01JPC00000000000000000001", "author": { "handle": "nova", … },
      "body": "morning all - shipping day", "created_at": "2026-10-10T21:00:00Z",
      "edited": false, "edited_at": null, "revision": 1, "media": null, … } ],
  "next_cursor": "MTc5MTY2NjAwMDAwMDpwXzAxSlBDMDAwMDAwMDAwMDAwMDAwMDAwMDE",
  "generated_at": "2026-10-10T21:09:00Z"
}
```

`p_01JPC…001` is the **20th and last** item, so `next_cursor` (`C1`) decodes to that post's key. The
page was assembled by: reading `kai`'s pushed entries (Redis/Timeline Store), reading `kai`'s pull
list (includes `nova`), merging `nova`'s celebrity list into the cursor window, then hydrating ids
against the Redis post cache → Post Store. At this instant `kai`'s client renders **revision 1,
`edited:false`**.

### Step 4 — `nova` edits inside the window (T0+10m = 21:10:00)

```http
PATCH /posts/p_01JPC00000000000000000001 HTTP/1.1
Authorization: Bearer eyJ…                        # sub = u_01JNOVA000000000000000001
If-Match: 1
Content-Type: application/json

{ "body": "morning all - shipping day (v2)" }
```

```http
HTTP/1.1 200 OK
{ "post_id": "p_01JPC00000000000000000001", …,
  "body": "morning all - shipping day (v2)",
  "edited": true, "edited_at": "2026-10-10T21:10:00Z", "revision": 2, … }
```

The authorisation check passes (`sub == author_id`, `21:10:00 ≤ 21:15:00`). State changes:

| Component | State after step 4 |
|-----------|--------------------|
| Post + Revision Store | post row now body v2 / revision 2 / `edited_at=21:10:00Z`; append revision row `(p_01JPC…001, 2)` |
| Post cache (Redis) | key `p_01JPC…001` **invalidated** |
| Celebrity list | **unchanged** — it stores `(author, created_at, post_id)`, not content, so an edit does not touch it |
| Timeline Store (push) | **unchanged** — no rows to rewrite (the id-based model, decision record 2) |
| Kafka `posts` | one `post.updated` event |
| Search | step 5 |

### Step 5 — search reflects the edit (≤ 21:10:05)

The Search Indexer upserts the same `_id` with body v2 and `revision: 2`. Between step 4 and this
point (≤ 5 s) search returns v1 for a query that matches it — the first named inconsistency below.

### Step 6 — `kai` requests page 2 (T0+10m30s = 21:10:30)

```http
GET /timelines/home?limit=20&cursor=MTc5MTY2NjAwMDAwMDpwXzAxSlBDMDAwMDAwMDAwMDAwMDAwMDAwMDE
Authorization: Bearer eyJ…
```

```http
HTTP/1.1 200 OK
{
  "items": [ /* 20 pushed posts strictly older than C1; none is p_01JPC…001 */ ],
  "next_cursor": "MTc5MTY2NTk0MDAwMDpwXzAxSlBDMDAwMDAwMDAwMDAwMDAwMDAwMDk",
  "generated_at": "2026-10-10T21:10:30Z"
}
```

Because `C1` is a strict keyset watermark, the merge for page 2 includes only items **older** than
`p_01JPC…001`. The edited post is not re-emitted. Had any item in this page been `p_01JPC…001`'s
newer sibling still unread, it would hydrate from the store as **revision 2** — hydration always
reads the latest revision.

### Step 7 — `kai` refreshes from the head (T0+11m = 21:11:00)

```http
GET /timelines/home?limit=20
```
The head request returns `p_01JPC…001` with **`revision: 2`, `edited: true`,
`edited_at: 21:10:00Z`**, and the client now renders the edited indicator.

### What the paginating follower sees

- **Not zero times.** The post was on page 1 at 21:09 and `kai` saw it.
- **Not twice.** The keyset cursor is a strict watermark; page 2 excludes `p_01JPC…001`, so it cannot
  reappear. No duplicate.
- **Exactly once, in one version at a time — but potentially a *stale* version.** `kai`'s rendered
  page 1 shows **revision 1** while the source is already revision 2. The client holds a stale
  revision until the next head fetch (step 7). It cannot see two versions *simultaneously in one
  pagination sequence*; it can see v1, then later v2, across a refresh. The edited indicator is
  likewise stale on the old page.

### Every inconsistency, and for how long

| # | Inconsistency | Between | Window |
|---|---------------|---------|--------|
| 1 | Post Store vs Redis post cache | step 4 write and cache invalidation | sub-second in-line; if invalidation is lost, bounded by the post-cache TTL (~seconds) |
| 2 | Search index vs Post Store | step 4 and step 5 | ≤ 5 s (indexer micro-batch; the SLO) |
| 3 | `kai`'s rendered page vs source | step 4 and step 7 (refresh) | until the client fetches the head; ~60 s in this trace, unbounded if the client never refreshes |
| 4 | Pull-list pointer vs post content | — | none: the celebrity list stores keys, not content, so there is nothing to reconcile |
| 5 | Search result body vs current body after an edit | step 4 and step 5 | ≤ 5 s, same as #2 |

The design's guarantee is: **within one cursor-pinned pagination sequence, no post is duplicated or
skipped; across a refresh, the newest revision is served.** The residual risk is client-side staleness
of an already-rendered page, which is inherent to caching and is bounded by refresh cadence, not by
the backend.

## 9. Security

- **Authentication and sessions.** OAuth 2.1/OIDC; 15-minute RS256 JWTs validated at the gateway;
  rotating opaque refresh tokens held server-side; `jti` denylist in Redis for immediate revocation
  (logout-all, account deletion). No credentials in URLs or cookies for the API.
- **Authorisation on edit and delete.** Edit requires `sub == post.author_id` **and** the 15-minute
  window; account deletion is self-only. Both are enforced server-side, never by the client.
- **Abuse and rate limiting.** Per-`sub` and per-IP token buckets at the gateway, tighter for
  publish, search and follow; search query length capped; cost-based limits on expensive merges; a
  moderation hook sits after ingest and before fanout (section 1) so a verdict can suppress fanout
  without changing the contract.
- **Image upload.** Content-type allowlist **plus magic-byte sniffing** (never trust the declared
  type), 2 MB cap enforced at URL issuance, asynchronous malware scan, full re-encode that strips
  EXIF/GPS and any embedded script, and **no SVG** (it is a script container). User content is served
  from a distinct origin/domain so it can never share a cookie scope with the app.
- **Output escaping.** Post bodies are treated as plain text and HTML-escaped on render; a strict
  Content-Security-Policy and `X-Content-Type-Options: nosniff` are set; URLs in bodies are linkified
  only after scheme allowlisting.
- **Personal data and what deletion removes.** Phase 0 removes visibility; phase 1 removes posts,
  revisions, timeline entries, search documents, cache keys and S3 objects. It also removes the
  media renditions and invalidates CDN copies. **Backups retain data until their rotation window
  expires** — stated explicitly rather than claimed otherwise; account deletion is recorded so a
  restore can re-apply tombstones.
- **Transport.** TLS 1.2+ everywhere, HSTS, internal service-to-service mTLS.

## 14. Trade-offs and what you would do with more time

**Deliberately traded away:** real-time (strongly consistent) timeline reads — I chose eventual
consistency for fanout scalability; recommendation and ranking — explicitly out of scope, so the
timeline is strictly reverse-chronological; multi-region active-active — I designed for a single
primary region with CDN at the edge, accepting cross-region read latency; rich moderation — only a
hook, not a pipeline; and per-post analytics — not designed.

**What I would build next, in order, and why that order:**

1. **Replace the guessed fanout threshold with a measured, adaptive one.** It is the highest-risk
   unvalidated number (critique 1) and everything downstream depends on it. Cheap to build, and it
   de-risks the write path.
2. **Prove and, if needed, redesign the purge path.** It carries a hard external promise (24 h) and a
   hidden cost (2× fanout writes) (critique 2). A load test comes before any new feature.
3. **Bound the pull/merge worst case** with a per-viewer merge cap or cached materialisation
   (critique 3), so one heavy follower cannot degrade the read SLO for others.
4. **Multi-region read replicas and, later, active-active**, once the single-region SLOs are proven.
5. **A ranking/recommendation layer**, which is out of scope here but is the obvious next product
   change and would sit behind the timeline service without altering the storage model.

The order is risk-first, not value-first: the first three items above are the only places where I
have a specific reason to doubt that the stated SLOs hold under the prompt's numbers.