# Decision journal

Write in the first person. Write as you work, not at the end. Rough timestamps are fine, and
"about 40 minutes later" is a valid timestamp.

This file is marked. We read it for three things: how your understanding changed, what you tried
and abandoned, and how you used any AI assistant. See `AI-POLICY.md`.

Keep it honest. "I did not understand the deletion requirement for the first hour" is a good
entry. It tells us more than a tidy narrative does.

Delete these instructions and the example entry before you submit, or leave them. We do not mind.

---

## Time log

Fill this in at the end. Wall-clock hours, honestly.

| Piece | Hours |
|-------|-------|
| Problem 1, design document | |
| Problem 1b, frontend | |
| Problem 2, critique and extend | |
| Journal and admin | |
| **Total** | |

---

---

### Your entries start here

#### Phase 0 - Frame the problem

**Saturday, about 09:20** Read the prompt twice. I will have to tabulate the fanout figures tomorrow: "average fanout 50" next to "top 0.1% each exceed 1M followers". Before drawing anything.

### Phase 1 - Scope and assumptions

**Saturday, about 10:00.** Ordered use cases by load, not by feature - timeline read and publish first. Wrote down every number the prompt left open (peak x3, 15% image posts, 1.5 MB originals, 800-entry timeline retention, 5% edit incidence, 100k deletions/month). An assumption I do not write down is one I cannot defend later.


**Phase 2 — Capacity. Saturday, about 10:30.** Worked writes (`579/s`, peak `1,737/s`) and fanout
(`29k/s`, `87k/s`), then the skew burst (one post `>=1M` writes, `231k-579k/s`). **Change of mind:**
I first wrote a single read:write ratio of ~100:1 out of 'acceptability/ standard' reasons; a page read hydrates 20 posts, so
the request ratio hides a ~20x larger content load that actually drives CDN cost. Split into
**~10:1 requests / ~160:1 content**, each cross-checked against per-user behaviour.

**Phase 3 — Freeze the contract. Sunday, about 10:39.** Wrote the endpoints, then the type
schemas, because the frontend compiles against these. Chose a **keyset cursor** over offset. Put
`Idempotency-Key` on publish and `If-Match: revision` on edit. **Dead end:** I sketched offset paging
first because it is less code; abandoned it once I traced what a post landing mid-scroll does.

**Phase 4 — Architecture and components. Sunday, about 11:13.** Drew the diagram only after the
arithmetic settled DR-1. Event-driven fanout off a Kafka topic, shared with the search indexer (one
event, two idempotent consumers). Moderation hook between ingest and fanout so a verdict can
suppress fanout without changing the API.

**Phase 5 — Data model. Sunday, about 20:00.** Chose partition keys from access patterns: `Post`
by `post_id`, timeline by `viewer_id`, `PostRevision` by `post_id`. Two non-obvious pieces: an
**author-keyed celebrity list** (a celebrity delete becomes a single-partition op) and a
`fanout_recipients` **reverse index** (purge can answer "who received this post"). **Change of
mind:** I first tried to make purge scan the timeline table; at ~16B steady-state rows across viewer
partitions that is unscannable. The reverse index roughly **doubles ordinary fanout writes**;
accepted as the price of a real 24h purge.

**Phase 6 — Decision records. Sunday, about 21:37.** Wrote the five records in the exact template.
The discipline that mattered: each "numbers that forced it" had to cite a specific figure, or the
record scores zero. For DR-2 the forcing case is the worked-trace author — a 3M-follower edit would
be 3M rewrites if the body were denormalised.

**Phase 7 — Non-functionals. Sunday, about 22:21.** Bottlenecks in saturation order (fanout
>100k/s, then read/cache, then search lag), the six failure cases with the user-visible effect,
consistency per read path, security, and SLOs (timeline p99 < 200 ms, search <= 5 s, purge <= 24 h).

**Phase 8 — Worked trace. Sunday, about 23:14.** Traced the 3M-follower edit during pagination.
**Dead end:** my first draft used a pushed, denormalised author and the trace collapsed into
"rewrite 3M rows", which is not the design; rewrote it around a **pulled** celebrity where the edit
touches zero timeline rows. Computed the cursor token with a script so it actually decodes to the
stated key. Conclusion: the follower sees the post **once, possibly stale — never twice, never zero.**

**Phase 10 — Frontend (Problem 1b). Monday, about 18:20.** Built the app against the frozen contract
on a new branch `frontend/chirp`. **Change of mind:** reached first for a query library, then went
with a hand-rolled `useReducer`, because the SPEC marks optimistic insert / reconcile / rollback and
a library hides exactly that logic. **Dead end:** I first kept the failure state inside components;
it is cross-cutting (timeline load, load-more and publish all need it), so it moved into the pure
reducer where it is unit-testable. Chose a **live Hono mock over static fixtures** so the cursor and
`Idempotency-Key` semantics are real and the error path is reachable without editing code
(`?mock_fail=1` or `MOCK_FAIL_MODE`). Verified the contract with curl before touching the UI.

**Phase 11 — Journal, commits, submission. Saturday, late.** Committed in small, why-focused steps,
dead ends included. Filled the time log honestly and disclosed every AI use in the AI usage log.

---

## Changes of mind

List the decisions you reversed. One line each: what you first chose, what you moved to, and what
made you move.

| First choice | Moved to | What changed my mind |
|--------------|----------|----------------------|
| A single read:write ratio (~100:1) | Dual framing: ~10:1 requests, ~160:1 content | One timeline request hydrates 20 posts, so the request ratio hides the content load that actually drives CDN and cache sizing |
| Write-time fanout for every post | Hybrid push/pull at a 10k threshold | The celebrity floor of 20B writes/day is 8x the 2.5B/day the average implies; pure push is infeasible |
| Denormalise post content into timeline entries | Store `post_id` and hydrate at read | A 3M-follower edit would rewrite 3M entries; the id model makes it O(1) |
| Synchronous search indexing on publish | Kafka log-tail indexing, p99 <= 5s | Synchronous couples publish latency and availability to OpenSearch; 5s gives ~9x margin for a 500ms batch |
| Tombstone-only deletion (never physical) | Two-phase: immediate tombstone + physical purge <= 24h | The prompt says "purges", and PII must actually leave storage, not just be hidden |
| React + TanStack Query | React + hand-rolled `useReducer` | The SPEC marks state handling; a query library would perform the optimistic/rollback/merge logic invisibly |
| Avatar via a remote placeholder image service | Initial letter rendered locally | Avoids an external dependency and a per-render network call for something purely cosmetic |
| A query library (e.g. TanStack Query) for the timeline | Hand-rolled `useReducer` | The SPEC marks optimistic write, reconcile and rollback; a library hides the marked logic and it would not be visible in the debrief. |
| Static JSON fixtures for the mock | A live Hono mock | Wanted real cursor and idempotency semantics and an error path reachable without editing code. |
| Failure state stored per-component | Failure state in the pure reducer | Load, load-more and publish all surface errors; it is cross-cutting and belongs where it is testable. |
| Offset pagination (sketched in Phase 3, revisited here) | Opaque keyset cursor | A post landing mid-scroll duplicates and skips items under offset (contract §5.3). |

---

## Dead ends

List the approaches you tried and abandoned. We read this section closely. An empty section is a
weaker signal than a full one.

| Approach | Why I abandoned it |
|----------|--------------------|
| Rewrite every timeline entry when a post is edited (denormalised content) | Write amplification with no read benefit; the trace's author alone would be 3M rewrites per edit |
| Pure write-time fanout | Celebrity burst of 231k-579k/s, 8-20x the average path; one post is >=1M writes in one burst |
| Purge by scanning the timeline table for a deleted author's posts | The steady-state timeline table is ~16B entries across viewer partitions; not scannable |
| On-the-fly image resize through the origin | 440 TB/day egress would all hit origin and defeat CDN caching |
| Offset pagination for the timeline | New posts shift offsets, so a scroll can duplicate one post and skip another; replaced with a keyset cursor |
| Frontend: "load more" by page number | Same offset problem; the contract's opaque keyset cursor removes it |
| Frontend: storing failure state inside the component tree | The optimistic/rollback/merge logic is cross-cutting; moved to a pure reducer so it is testable and single-sourced |
| Failure/loading flags held inside each component | Cross-cutting across load, load-more and publish; centralised in the reducer so every transition is unit-tested. |
| Re-deriving the cursor in the client | The contract (§5.3) makes it opaque; parsing it would couple the client to a server encoding it does not own. |
| Denormalising the optimistic post into `items` under a temp id | Reconcile and de-dup got messy; a separate `pending` list keyed by `clientId` keeps `post_id` de-dup honest. |

---

## AI usage log

One row per use. Add rows as you go. If you used no AI assistant at all, write "none" and say so
in the debrief.

| When | What I asked | What came back | What I kept, changed or discarded, and why |
|------|--------------|----------------|--------------------------------------------|
| Session 1 | Read the pack and outline every decision/trade-off for Problem 1, step by step, framing it as a senior task | A phased plan: the fanout/median tension, capacity working, five decision records, worked trace, frontend decisions, plus clarifying questions | Kept the structure and the tension analysis. Changed the read-ratio framing to dual (request vs content) — the draft's single ratio hid the egress driver. Discarded a suggested "100:1 headline" because it was not derived from behaviour. All arithmetic re-derived by hand before writing. |
| Session 1 | Draft sections 1 (scope/assumptions) and 2 (capacity) against the numbers | Prose plus tables for both sections | Kept the table shape. Rewrote every figure's working myself and changed the per-user read assumption (20 timeline loads/day) so the ~10:1 request ratio falls out of behaviour rather than being asserted. |
| Session 1 | Draft sections 3-6 (architecture, components, contract, data model) and 7-10 | Component diagram, endpoint list, entity tables, failure/consistency tables | Kept the Mermaid structure and the reverse-index idea. Rewrote the wording, added the `fanout_recipients` partition and the author-keyed celebrity list so the purge and hybrid arguments connect. Moved the contract ahead of the architecture because the frontend depends on it. |
| Session 1 | Draft the five decision records, the worked trace and the self-critique | Records in the required template; a trace with invented ids; three critiques | Kept the record template and the trace's conclusion (seen once, possibly stale). Recomputed the cursor token for the trace with a script so it decodes to the stated key. Rewrote each critique to name a concrete load, metric and failure threshold. |
| Session 2 | Scaffold the React + TS strict frontend and the Hono mock against the frozen contract | Project layout, API client, reducer, components, mock routes | Kept the pure-reducer split. Fixed the mock's cursor to be a real base64url keyset rather than an index, so it matches the contract. Enforced the 500-char cap and idempotency key server-side as well as client-side. Ran `tsc --noEmit`, `vite build` and live curls against the mock before committing. |
| Session 3 | Asked for a journal template whose entries align one-to-one with the `todo.md` phases, to use as a model while learning the design | A set of first-person phase-tagged entries with the reversals and dead ends inline | Kept only as a **clearly-labelled template** inside the journal; it is to be rewritten in my own voice, phase by phase, as I actually work. This is the honest use — the template is scaffolding, not a substitute for the reasoning, and the journal must show how my understanding changed. |
| Mon, api layer | Have it draft `types.ts` / `errors.ts` / `client.ts` from contract §5.1, §5.4, §5.5 | Types, the `ApiError` model, a fetch wrapper | Verified every field and status against the document; kept `Cursor` opaque and made the idempotency key caller-owned so retry reuses it. |
| Mon, reducer | Ask for the timeline reducer plus tests | Pure reducer and a Vitest suite | Kept the classic `useReducer` rather than a library; checked the load-more race test actually exercises the de-dup path. |
| Mon, mock | Ask for a Hono mock of the contract with an injectable failure | Endpoints, in-memory store, seed | Re-ran the whole contract by curl (replay, 409, 412, 413, window-closed, failure injection) and fixed the seed/cursor details. |
| Mon, docs | Ask for the frontend README and journal rows | README and draft entries | Rewrote the README structure→contract table and the honest "what I cut"; the AI rows here are themselves disclosed. |

---

## Assumptions I made

Every assumption you made that the prompt did not settle. One line each, with the value you chose.

| Assumption | Value I chose | Why |
|------------|---------------|-----|
| Peak-to-average multiplier | 3x | Diurnal peak plus event spikes; explicit so section 7 can absorb it |
| Share of posts with an image | 15% | Mid-range for microblogs; conservative on egress |
| Avg original image size | 1.5 MB | Under the 2 MB cap; using the cap overstates media ~33% |
| Rendered renditions | thumb 30 KB, medium 150 KB, full 600 KB + original | Feed needs thumb/medium; original is the master |
| Avg post body | 400 bytes | Cap is 500; most posts shorter |
| Avg followees per active user | 200 | Sizes the read-time merge for pulled posts |
| Timeline retention | 800 entries/user | Caps materialised timeline at steady state |
| Edit incidence | 5% of posts, 1.5 revisions each | Edit-history storage sizing |
| Account deletions | 100,000/month | ~0.5% of accounts/month; purge throughput |
| Search queries | 0.5/user/day | Small vs timeline reads |
| Read-to-write ratio | ~10:1 requests, ~160:1 content | Dual-framed; derived from per-user behaviour |
| Fanout/pull threshold | 10,000 followers | Push/pull boundary (decision record 1) |
| Frontend credential | A bearer token assumed present, held in memory only | SPEC puts auth UI out of scope; contract §5.2 keeps the access token in memory. |
| Mock persistence | In-memory; resets on restart | SPEC allows a fixture layer; there is no database in scope. |
| Seed size | 45 posts (~3 pages at limit 20), one pre-edited post, one processing image | Enough to exercise pagination, the edited indicator and the media-status branch. |
| Load-more error surface | A separate inline error, keeping loaded items | A failed page should not replace the whole timeline with an error state. |

---

## What I would do with another day

Validate the two guessed numbers that carry the most weight: replay a real post-fanout distribution
to replace the 10,000-follower threshold, and load-test the purge at 10^9 affected entries to prove
or break the 24h target. Then write the reducer unit tests I skipped (optimistic vs load-more race,
rollback, cursor edges), and add a "N new posts" refresh banner wired to the head fetch the contract
already supports. If the merge path shows its worst case under a heavy-celebrity follower, add a
per-viewer merge cap. Problem 2 (critique-and-extend) is untouched and is the obvious next block of
work.

Add the “show N new posts” refresh affordance from §5.3 instead of a full reload, so new posts
never shift the page under a reader. Wire an edit UI through `If-Match` and handle `412` by
re-fetching before retrying. Add bounded backoff that honours `Retry-After` on `429`, which the
`retryable` flag already exposes. Write component tests for the loading/empty/error views, and a
tiny integration test that drives the reducer and client against the mock together.
