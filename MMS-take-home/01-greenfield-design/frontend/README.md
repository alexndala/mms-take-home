# Chirp home timeline — frontend (Problem 1b)

A home-timeline view for Chirp that consumes the API contract written in
`../DELIVERABLE.md` section 5. Strict TypeScript, no `any`. This is the frontend half of Problem 1;
it compiles against the same types the design document describes.

## Run it

Node **22** (see `.nvmrc`; `node -v` was `v22.22.1` when this was written).

```
npm install
npm run dev
```

`npm run dev` starts two processes: the Hono mock on port **8787** and the Vite dev server on
**5173**. Vite proxies `/v1` to the mock, so the app and the API come up with one command. Open
http://localhost:5173.

Other scripts: `npm run mock` (mock only), `npm run web` (app only), `npm run typecheck`,
`npm test`, `npm run build`. The mock port is overridable: `PORT=9000 npm run mock`.

## Structure, and which contract part each module implements

| File | Section 5 of the contract it implements |
|------|-----------------------------------------|
| `src/api/types.ts` | §5.1 `Post`, `Revision`, `Author`, `Media`, page envelopes. Nullability (`media`, `edited_at`) copied exactly. |
| `src/api/errors.ts` | §5.5 error model: `ApiErrorInfo` / `ApiErrorEnvelope`, the `ApiError` class, `parseError`, `asApiError`. |
| `src/api/client.ts` | §5.1 endpoints (`/timelines/home`, `/posts`, `/posts/{id}/revisions`), §5.2 `Authorization: Bearer`, §5.3 opaque cursor pass-through, §5.4 `Idempotency-Key` on publish, `If-Match` on edit. |
| `src/state/timelineReducer.ts` | §5.3 cursor pagination; §5.4 safe publish retry; optimistic insert, reconcile and rollback; de-duplication by `post_id` (the load-more race). |
| `src/components/*` | SPEC behaviour list: timeline + load more, loading/empty/error views, composer (optimistic write), edited indicator + revision history. |
| `mock/server.ts` | The full §5.1 endpoint set and §5.5 error model, plus the failure switch. |
| `mock/cursor.ts` | §5.3 cursor encoding `base64url(created_at_ms ":" post_id)`. Mock-side only; the frontend never decodes a cursor. |
| `mock/store.ts` | §5.3 sort `(created_at DESC, post_id DESC)` and strict watermark; §5.4 idempotency and the 15-minute edit window. |
| `mock/seed.ts` | Seed data: 45 posts, one already-edited post with two revisions, one processing image. |

The app talks to the mock through the same types the real API would use, so a backend swap is a base
URL change.

## How to trigger the error path

Three ways, all without editing code:

1. Tick **“Inject mock failure”** in the header. Requests then carry `?mock_fail=1` and the mock
   answers `503` with the §5.5 envelope. The timeline renders `ErrorState` from that model.
2. Run the mock with `MOCK_FAIL_MODE=timeline npm run mock` — timeline reads fail.
3. Run with `MOCK_FAIL_MODE=publish npm run mock` — publishing fails, so you can watch the
   optimistic post roll back and the `PublishErrorBanner` appear.

The error views render `error.code`, `error.message`, `error.request_id` and honour
`error.retryable`; they never guess from an HTTP status.

## Behaviour notes

- **Cursor pagination.** *Load more* sends `next_cursor` back verbatim. The client has no knowledge
  of the cursor’s contents (see `Cursor` in `types.ts`).
- **Optimistic publish.** The post appears immediately keyed by a client id. On `201` it reconciles
  to the server `Post` (replaced only if its `post_id` is not already present — this is what makes a
  publish racing a *Load more* safe). On failure it rolls back and shows the banner. A retry reuses
  the **same** `Idempotency-Key`, so it cannot create a duplicate.
- **Edited indicator.** `PostCard` shows “Edited · <time>” from `edited` / `edited_at`. “Edit
  history” fetches `GET /posts/{id}/revisions` and lists prior bodies newest-first.

## What I cut, and what I would do next

**Cut (out of scope per SPEC, stated rather than hidden):**

- Authentication UI. A credential is assumed present: an in-memory bearer token stub in
  `client.ts` (§5.2 keeps the access token in memory only).
- Image upload. Posts can *display* media, but the composer never uploads one.
- Styling polish. Plain and legible.
- A real backend — the Hono mock stands in.

**Tests:** the reducer has a focused Vitest suite (`src/state/timelineReducer.test.ts`) covering
reconcile, rollback, the load-more race and pagination. There are **no** component or end-to-end
tests; that is the deliberate cut.

**Next, in order:** a “show N new posts” refresh affordance (§5.3); an edit UI exercised through
`If-Match` (`412` → re-fetch); retry with bounded backoff honouring `Retry-After` on `429`;
component tests for the state views.
