/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Non-secret flag enabling the local server proxy. */
  readonly VITE_GROQ_PROXY_ENABLED?: boolean
  /** URL of the deployed proxy/groq-worker.js; the key lives there, not in the app */
  readonly VITE_GROQ_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
