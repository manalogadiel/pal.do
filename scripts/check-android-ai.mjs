import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { runAndroidAiTests } = await server.ssrLoadModule('/src/lib/android-ai.reliability.ts')
  const failures = await runAndroidAiTests()
  failures.forEach((failure) => console.error(failure))
  process.exitCode = failures.length ? 1 : 0
} finally { await server.close() }
