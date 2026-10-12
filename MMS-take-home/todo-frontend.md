# Chirp frontend — build plan (Problem 1b)

Working plan for TODO Phase 10. It expands each sub-task into concrete files, decisions and exit
criteria. The contract is frozen in `01-greenfield-design/DELIVERABLE.md` §5; this document does not
re-open it.

| | |
|---|---|
| **Owner** | Mahlatse |
| **Branch** | `frontend/chirp` |
| **Scope** | Problem 1b only (Phase 10). Problem 2 deferred. |
| **Contract source** | `01-greenfield-design/DELIVERABLE.md` §5 (types §5.1, cursor §5.3, idempotency §5.4, errors §5.5) |
| **Spec** | `01-greenfield-design/frontend/SPEC.md` |
| **Node** | 22 (pinned in `.nvmrc`) |
| **Commit rule** | one commit per sub-task 10.1 → 10.7; docs updated as we work |

This file supersedes the Phase 10 stub formerly in `TODO.md`. Decision D10 (hand-rolled `useReducer`,
not a query library) carries here as **F6**; D10b (Hono mock, not static fixtures) carries here as
**F8**. Nothing else from that stub is lost.

### Working rules

- **Contract consistency is the top-marked criterion.** Every type, header and error field below is
  copied from §5, not invented. If code and document disagree, both lose marks.
- `strict` is genuinely on, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. No `any`.
- Commit small. Update `DECISION-JOURNAL.md` (AI usage log, changes of mind, dead ends) in the same
  pass, not at the end.

---

## 10.1 — Scaffold (commit: `chore(frontend): scaffold vite + react + ts strict`)

**Goal:** a clean checkout runs `npm install` then `npm run dev` and serves the app plus a proxied
API. TypeScript is strict and honest.

- [ ] `01-greenfield-design/frontend/` becomes the app root (remove `.gitkeep`).
- [ ] Hand-authored configs, **not** `create-vite`, so the strict flags are guaranteed.
- [ ] `.nvmrc` = `22`; commit `package-lock.json`.
- [ ] `.gitignore` (node_modules, dist, coverage).

Files:

```
frontend/.nvmrc                 22
frontend/.gitignore
frontend/package.json
frontend/package-lock.json
frontend/tsconfig.json          # app: src only
frontend/tsconfig.node.json     # vite.config.ts + mock
frontend/vite.config.ts         # dev proxy /v1 -> :8787
frontend/index.html
frontend/src/main.tsx
frontend/src/App.tsx            # placeholder
frontend/src/styles.css
```

Dependencies:

- runtime: `react`, `react-dom`, `hono`, `@hono/node-server`
- dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`,
  `@types/node`, `tsx`, `concurrently`, `vitest`

`tsconfig.json` compiler options (the marked ones):

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "noImplicitOverride": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "moduleResolution": "bundler",
  "module": "ESNext",
  "target": "ES2022",
  "jsx": "react-jsx",
  "lib": ["ES2022", "DOM", "DOM.Iterable"],
  "noEmit": true,
  "skipLibCheck": true
}
```

Scripts:

```jsonc
{
  "dev": "concurrently -k -n mock,web \"npm:mock\" \"npm:web\"",
  "mock": "tsx watch mock/server.ts",
  "web": "vite",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit",
  "test": "vitest run",
  "preview": "vite preview"
}
```

**Decision F1 — hand-authored config.** A generator hides the exact flags and may add ones I did
not choose. *Trade-off:* a little more typing now, but the compiler settings are reviewable and
match the spec's `strict: true` exactly.

**Decision F2 — separate Hono server + Vite proxy.** `mock` and `web` run side by side; Vite proxies
`/v1` to `:8787`. *Trade-off:* two processes and `concurrently`, but `npm run mock` is independently
curliable and the setup resembles a real deploy.

**Exit criteria:** `npm install` clean; `npm run typecheck` passes; `npm run dev` serves the
placeholder app and `curl localhost:5173/v1/...` proxies to the mock.

---

## 10.2 — API types and error model (commit: `feat(frontend): api types + error model`)

**Goal:** the §5 schemas and §5.5 error model exist as types the rest of the app compiles against.

Files:

```
frontend/src/api/types.ts
frontend/src/api/errors.ts
```

- [ ] `types.ts`: `Author`, `Media`, `Post`, `Revision`, `TimelinePage`, `RevisionPage`,
  `PublishPostRequest`, `EditPostRequest`.
- [ ] Nullable fields modeled as `| null` exactly as §5.1 states (`media`, `edited_at`).
- [ ] `type Cursor = string` — opaque; the client never encodes or decodes it.
- [ ] `errors.ts`: `ApiErrorBody` (`{ error: { code, message, retryable, request_id, details? } }`),
  an `ApiError extends Error` class carrying the fields, `parseError(response): Promise<ApiError>`,
  and named code constants (e.g. `EDIT_WINDOW_CLOSED`).

**Decision F3 — `Cursor` is an opaque brand-ish `string`, never parsed.** §5.3 defines the encoding
but the contract says the client treats it as opaque. *Trade-off:* we cannot jump to page N; that is
the accepted cost of keyset pagination.

**Decision F4 — `ApiError` renders from `code` and `message`, never the HTTP status.** §5.5 makes
`retryable` server-authoritative. *Trade-off:* no free status-driven UX, but the UI cannot drift
from the contract's error semantics.

**Exit criteria:** `typecheck` passes; every field name in `types.ts` is greppable in §5.

---

## 10.3 — API client (commit: `feat(frontend): api client with cursor + idempotency`)

**Goal:** one module that speaks exactly the §5 contract and surfaces errors as `ApiError`.

Files:

```
frontend/src/api/client.ts
```

- [ ] `ChirpClient` with `getHomeTimeline({ limit, cursor })`, `publishPost({ body, mediaId }, idempotencyKey)`,
  `editPost(postId, body, revision)`, `getRevisions(postId, { limit, cursor })`.
- [ ] Base URL `/v1` in dev, overridable via `import.meta.env.VITE_API_BASE`.
- [ ] `Authorization: Bearer` set from an in-memory token stub (SPEC: assume a credential is present).
- [ ] `Idempotency-Key` is caller-supplied so the composer generates **one key per user intent** and
  reuses it on retry (§5.4).
- [ ] `PATCH` sends `If-Match: <revision>`.
- [ ] Non-2xx → `parseError` → throw `ApiError`. 204/202 handled without JSON parse.

**Decision F5 — key generated once per intent, owned by the caller, not the client.** §5.4 says a
safe retry reuses the identical key. *Trade-off:* the composer must hold the key, but a retry can
never create a duplicate post.

**Exit criteria:** `typecheck` passes; a publish retried with the same key is a no-op on the server
(verified again in 10.6).

---

## 10.4 — Timeline reducer (commit: `feat(frontend): timeline reducer (optimistic/reconcile/rollback)`)

**Goal:** the marked state handling lives in one pure, tested function.

Files:

```
frontend/src/state/timelineReducer.ts
frontend/src/state/timelineReducer.test.ts
```

- [ ] State: `items: Post[]`, `nextCursor: string | null`, `phase`,
  `error: ApiError | null`, `pending: OptimisticPost[]`, `publishing: boolean`,
  `publishError: ApiError | null`.
- [ ] Actions: `LOAD_START/SUCCESS/ERROR`, `LOAD_MORE_START/SUCCESS/ERROR`,
  `PUBLISH_OPTIMISTIC/SUCCESS/ERROR`, `DISMISS_PUBLISH_ERROR`.
- [ ] Optimistic insert keyed by a `clientId`; **reconcile** removes the pending entry and inserts
  the server `Post` unless its `post_id` is already present.
- [ ] **Rollback** drops the pending entry and sets `publishError`.
- [ ] **Dedupe by `post_id`** on every append and reconcile, so the load-more-vs-publish race cannot
  double-render a post.
- [ ] Vitest: reconcile, rollback, dedupe race, cursor append, error→phase.

**Decision F6 — hand-rolled reducer over a query library.** The SPEC marks optimistic/reconcile/
rollback explicitly; a library would hide it. *Trade-off:* more code, but every transition is
visible and unit-testable.

**Exit criteria:** `npm test` green; reducer has no `fetch` and no `any`.

---

## 10.5 — Components (commit: `feat(frontend): timeline, card, composer, state views`)

**Goal:** the behaviour list from SPEC §Behaviour, wired to the reducer.

Files:

```
frontend/src/components/HomeTimeline.tsx
frontend/src/components/TimelineList.tsx
frontend/src/components/PostCard.tsx
frontend/src/components/Composer.tsx
frontend/src/components/StateViews.tsx
frontend/src/components/PublishErrorBanner.tsx
frontend/src/components/RevisionHistory.tsx
frontend/src/App.tsx
```

- [ ] `App` owns `useReducer` + a `ChirpClient`; wires load, load-more, publish, refresh.
- [ ] Cursor pagination: a **Load more** control fetches `next_cursor`, disabled at the tail or
  while loading.
- [ ] Loading / empty / error states; the error state renders from the **error model**
  (`code`, `message`, `request_id`, `retryable`), never a bare string.
- [ ] Optimistic publish: the post appears immediately, then reconciles; on failure it rolls back
  and shows `PublishErrorBanner`.
- [ ] Edited indicator on `PostCard` when `edited === true`, showing `edited_at`; a toggle opens
  `RevisionHistory` which fetches `/posts/{id}/revisions`.
- [ ] Post bodies rendered as escaped plain text (§9), no `dangerouslySetInnerHTML`.

**Decision F7 — plain-text escaping, no HTML.** §9 treats bodies as plain text and escapes on
render. *Trade-off:* no rich linkification, which the SPEC does not ask for.

**Exit criteria:** `typecheck` clean; all four SPEC behaviours reachable by hand.

---

## 10.6 — Hono mock (commit: `feat(frontend): hono mock implementing the contract`)

**Goal:** a live server that implements the frozen contract, including real cursor and idempotency
semantics and a reachable failure path.

Files:

```
frontend/mock/server.ts
frontend/mock/store.ts
frontend/mock/seed.ts
frontend/mock/cursor.ts
frontend/mock/errors.ts
```

- [ ] Routes: `GET /v1/timelines/home`, `POST /v1/posts`, `GET /v1/posts/{id}`,
  `PATCH /v1/posts/{id}`, `GET /v1/posts/{id}/revisions`.
- [ ] Cursor `base64url(created_at_ms ":" post_id)`, sort `(created_at DESC, post_id DESC)`,
  strict watermark; `limit` default 20, max 50.
- [ ] Publish: 201 Post; `413` over 500 chars; `409` idempotency key reused with a different body;
  idempotent replay returns the original post.
- [ ] Edit: `If-Match` mismatch → `412`; past `published_at + 15 min` → `409 EDIT_WINDOW_CLOSED`.
- [ ] Every failure returns the §5.5 shape with a `request_id`.
- [ ] Seed ~45 posts across several authors (~3 pages at limit 20) plus one pre-edited post with
  revisions.
- [ ] **Failure injection:** UI toggle appends `?mock_fail=1`; `MOCK_FAIL_MODE=timeline|publish|all`
  also forces failures.

**Decision F8 — Hono, not static fixtures.** Real cursor, idempotency and edit-window semantics, and
a live-reachable error path. *Trade-off:* a server to run, but the state handling is exercised
honestly.

**Exit criteria:** curl proves paging, idempotent replay, `412`, `409`, and the error shape.

---

## 10.7 — README and journal (commit: `docs(frontend): readme + contract mapping`)

**Goal:** the required `frontend/README.md`, plus honest journal/TODO updates.

- [ ] `frontend/README.md`: install/run + Node version; structure and why; **which §5 module each
  file implements**; how to trigger the error path; what was cut and what is next.
- [ ] `DECISION-JOURNAL.md`: AI usage log rows, changes-of-mind and dead-ends tables.
- [ ] `TODO.md`: reconcile Phase 10 checkboxes to what actually shipped.

**Exit criteria:** a reader can map every module to §5 and can reproduce the failure path from the
README alone.

---

## 10.8 — Out of scope (do not spend time)

- [ ] Auth UI, image upload, styling polish, a real backend — declared in the README per SPEC.

---

## Verification gate (run before the final commit)

```
npm run typecheck     # tsconfig.json + tsconfig.node.json, no any
npm test              # reducer suite
npm run dev           # app + proxied API on one command
curl ... ?mock_fail=1 # error path renders from the error model
curl ... POST /v1/posts (replay)  # idempotency: no duplicate
```
