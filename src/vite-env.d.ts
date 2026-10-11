/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev only. Never used in builds. */
  readonly VITE_GROQ_API_KEY?: string
  /** URL of the deployed proxy/groq-worker.js; the key lives there, not in the app */
  readonly VITE_GROQ_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
