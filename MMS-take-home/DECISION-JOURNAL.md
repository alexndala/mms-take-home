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
I first wrote a single read:write ratio of ~100:1 out of habit; a page read hydrates 20 posts, so
the request ratio hides a ~20x larger content load that actually drives CDN cost. Split into
**~10:1 requests / ~160:1 content**, each cross-checked against per-user behaviour.

**Phase 3 — Freeze the contract. Sunday, about 10:39.** Wrote the endpoints, then the type
schemas, because the frontend compiles against these. Chose a **keyset cursor** over offset. Put
`Idempotency-Key` on publish and `If-Match: revision` on edit. **Dead end:** I sketched offset paging
first because it is less code; abandoned it once I traced what a post landing mid-scroll does.


**Phase 4 — Architecture and components. Sunday, about 13:00.** Drew the diagram only after the
arithmetic settled DR-1. Event-driven fanout off a Kafka topic, shared with the search indexer (one
event, two idempotent consumers). Moderation hook between ingest and fanout so a verdict can
suppress fanout without changing the API.

---

## Changes of mind

List the decisions you reversed. One line each: what you first chose, what you moved to, and what
made you move.

| First choice | Moved to | What changed my mind |
|--------------|----------|----------------------|
| | | |

---

## Dead ends

List the approaches you tried and abandoned. We read this section closely. An empty section is a
weaker signal than a full one.

| Approach | Why I abandoned it |
|----------|--------------------|
| | |

---

## AI usage log

One row per use. Add rows as you go. If you used no AI assistant at all, write "none" and say so
in the debrief.

| When | What I asked | What came back | What I kept, changed or discarded, and why |
|------|--------------|----------------|--------------------------------------------|
| | | | |

---

## Assumptions I made

Every assumption you made that the prompt did not settle. One line each, with the value you chose.

| Assumption | Value I chose | Why |
|------------|---------------|-----|
| | | |

---

## What I would do with another day

Three to five lines. Be specific.
