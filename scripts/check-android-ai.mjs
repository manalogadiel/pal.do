import { createServer } from 'vite'

// Isolated reliability cases include a missing-credentials scenario, independent of demo env files.
const server = await createServer({ define: { 'import.meta.env.VITE_GROQ_PROXY_ENABLED': 'false', 'import.meta.env.VITE_GROQ_PROXY_URL': '""' }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { runAndroidAiTests } = await server.ssrLoadModule('/src/lib/android-ai.reliability.ts')
  const failures = await runAndroidAiTests()
  failures.forEach((failure) => console.error(failure))
  process.exitCode = failures.length ? 1 : 0
} finally { await server.close() }
