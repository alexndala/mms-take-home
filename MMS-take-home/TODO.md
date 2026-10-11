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

---