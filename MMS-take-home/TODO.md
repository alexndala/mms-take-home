# Chirp — build plan and decision log

A phased task list for the MMS take-home (Problem 1: greenfield design + frontend).
It records not just *what* was done, but *why*, and what each choice cost. Every decision
below is traceable to a number from `PROMPT.md` or to the arithmetic in `DELIVERABLE.md` §2.

| | |
|---|---|
| **Owner** | Mahlatse |
| **Branch** | `design/chirp` |
| **Scope this pass** | Problem 1 (design doc), Problem 1b (frontend). Problem 2 deferred. |
| **Time budget** | 5 h design · 3–4 h frontend · 4 h Problem 2 · journal ongoing |
| **Current state** | Problem 1 and 1b not started; Problem 2 also not started |

### How to read this document

- Each task lists its **Decision** and **Trade-off** where a choice was made. Decision records
  match `DELIVERABLE.md` §11 (`DR-1` … `DR-5`).
- **Exit criteria** gate each phase; a phase is not done until they hold.
- Working rule: **show the arithmetic, name the number that forced the choice, state the cost.**

---

## Phase 0 — Frame the problem before designing anything

**Goal:** find the trap in the constraints before committing to a shape.

- **0.1** Read `README.md`, `AI-POLICY.md`, `PROMPT.md`, `DELIVERABLE.md`, `frontend/SPEC.md` in full.
- **0.2** Extract the constraint table and stress-test it for arithmetic contradictions.
- **0.3** Identify the primary tension and lock a reading.

---

## Phase 1 — Scope and assumptions

**Goal:** fix boundaries and make every unstated number explicit.

- **1.1** Order use cases by load, not by feature (timeline read and publish first).
- **1.2** List exclusions per the prompt; place the moderation hook without designing policy.
- **1.3** Write the assumptions register (peak multiplier, image mix, retention, edit rate…).

**Decision D1 — order work by traffic.** Timeline read and publish get the engineering effort;
follow/unfollow and edit history are correct but not hot.
- *Trade-off:* less polish on cold paths; accepted deliberately.

**Key assumptions (full table in §1 / journal):** peak ×3; 15% image posts; 1.5 MB avg original;
800-entry timeline retention; 5% edit incidence; 100k deletions/month; **read ratio dual-framed**.
- *Trade-off:* retention caps history at ~800 entries/user — bounded storage in exchange for not
  serving arbitrarily deep timelines.

**Exit criteria:** every figure used later is defined here. Met the requrement.

## Phase 3 — Freeze the API contract (before any frontend code)

**Goal:** make the contract the single source of truth the frontend compiles against.

- **3.1** Endpoints for publish, timeline, post, edit, revisions, search, follow, unfollow, delete, media.
- **3.2** Shared `Post` / `Revision` schemas (the types the frontend imports).
- **3.3** AuthN/Z: 15-min JWT + rotating refresh + `jti` denylist.
- **3.4** **Keyset cursor** `base64url(created_at_ms ":" post_id)`, strict watermark; new posts
  appear on refresh, never injected mid-page.
- **3.5** Idempotency: `Idempotency-Key` on publish; edit guarded by `If-Match: revision`.
- **3.6** Error model: `{ error: { code, message, retryable, request_id, details } }`; never 200 on a failed write.

**Decision D3 — cursor, not offset.**
New posts shift offsets, so offset pagination duplicates and skips items mid-scroll.
- *Trade-off:* clients cannot jump to "page N" and must replay from the head to refresh. Accepted;
  for a live feed, correctness beats random access.
**Decision D3b — `If-Match` revision on edit.**
- *Trade-off:* one extra round trip on conflict (`412`); in return, concurrent edits cannot silently clobber.

**Exit criteria:** the contract is complete enough to hand to the frontend without further design. Met the requirements.


## Phase 4 — Architecture, diagram, components

**Goal:** one diagram that agrees with the prose, the contract and the data model.

- **4.1** Mermaid component diagram (client → gateway → services → stores).
- **4.2** Write path prose (media → publish → Kafka → fanout/indexer).
- **4.3** Read path prose (cache → store → pull merge → hydration).
- **4.4** One subsection per component: responsibility, state, scaling, failure behaviour.

**Decision D4 — event-driven fanout off a Kafka topic, shared with the search indexer.**
One `post.created` event, two independent idempotent consumers.
- *Trade-off:* eventual consistency and a new failure mode (consumer lag) in exchange for
  decoupling publish latency from fanout and indexing.

**Exit criteria:** diagram and prose describe the same system as §5/§6. Meets the requirements.


## Phase 5 — Data model and sharding

**Goal:** choose keys from access patterns, not normal form.

- **5.1** `Post` partitioned by `post_id` (+ author index).
- **5.2** `PostRevision` `(post_id, revision)` full snapshots (cheap at 45 GB/mo).
- **5.3** Timeline partitioned by `viewer_id`, clustered `(created_at, post_id)`.
- **5.4** **Author-keyed celebrity list** (pull) — makes a celebrity delete a single-partition op.
- **5.5** Follow graph in **both directions** (fanout needs followers; pull-list/purge need followees).
- **5.6** `fanout_recipients` reverse index for purge (§6.7).
- **5.7** Search doc, media, idempotency, deletion-job tables.

**Decision D5 — store `post_id` in timelines, never content.** (See DR-2.)
- *Trade-off:* read amplification (20 hydrations/page) and a post-cache dependency, in exchange for
  O(1) edits.
**Decision D5b — pay ~2× ordinary fanout writes for the reverse index.**
- *Trade-off:* higher write cost in exchange for a real, bounded 24 h physical purge.

**Exit criteria:** each store's partition key is justified against §5 access patterns. Met the requirements.

---