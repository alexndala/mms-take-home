/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API base URL override; defaults to `/v1` (proxied to the mock in development). */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
