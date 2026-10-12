import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { runChatReliabilityTests } = await server.ssrLoadModule('/src/lib/chat.reliability.ts')
  const failures = await runChatReliabilityTests()
  for (const failure of failures) console.error(failure)
  console.log(`chat reliability: ${failures.length ? `${failures.length} failing` : 'pass'}`)
  process.exitCode = failures.length ? 1 : 0
} finally {
  await server.close()
}
