// Scores Pal's conversation behaviour. See src/lib/chat.eval.ts for the cases.
//   pnpm eval:chat                          rules engine only (offline, must be 100%)
//   GROQ_API_KEY=gsk_... pnpm eval:chat --llm   also score the online model. A full run is ~40 calls, roughly half a
//                                               model's free daily quota: use a separate key so the app keeps its own
//   pnpm eval:chat --local [model]              score your Ollama model instead (default qwen3.5:4b): free, no limits
//   EVAL_ONLY="okkkk|sabado" ...                 only the model cases matching that pattern
import { createServer, loadEnv } from 'vite'

const llm = process.argv.includes('--llm')
// --local [model]: score your Ollama model instead of Groq (free, no daily limit)
const li = process.argv.indexOf('--local')
const local = li < 0 ? undefined : {
  url: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.argv[li + 1] && !process.argv[li + 1].startsWith('--') ? process.argv[li + 1] : 'qwen3.5:4b',
}
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { runEval } = await vite.ssrLoadModule('/src/lib/chat.eval.ts')
  const apiKey = llm ? process.env.GROQ_API_KEY || loadEnv('development', process.cwd(), 'VITE_GROQ_').VITE_GROQ_API_KEY : undefined
  const r = await runEval({ llm, apiKey, only: process.env.EVAL_ONLY, local })
  console.log(`\nrules: ${r.rules.pass}/${r.rules.total}${r.llm ? `   model: ${r.llm.pass}/${r.llm.total}` : ''}`)

  const { runSessionTests } = await vite.ssrLoadModule('/src/lib/session.test-cases.ts')
  const sessionFails = await runSessionTests()
  for (const f of sessionFails) console.log(`✗ session ${f}`)
  console.log(`session: ${sessionFails.length ? `${sessionFails.length} failing` : 'pass'}`)

  const { runVoiceTests } = await vite.ssrLoadModule('/src/lib/timers.test-cases.ts')
  const voiceFails = runVoiceTests()
  for (const f of voiceFails) console.log(`✗ voice ${f}`)
  console.log(`voice (timers, commands, wake word): ${voiceFails.length ? `${voiceFails.length} failing` : 'pass'}`)

  const { runStudyTests } = await vite.ssrLoadModule('/src/lib/study.test-cases.ts')
  const studyFails = runStudyTests()
  for (const f of studyFails) console.log(`✗ study ${f}`)
  console.log(`study library: ${studyFails.length ? `${studyFails.length} failing` : 'pass'}`)

  const { runChatReliabilityTests } = await vite.ssrLoadModule('/src/lib/chat.reliability.ts')
  const reliabilityFails = await runChatReliabilityTests()
  for (const f of reliabilityFails) console.log(`✗ reliability ${f}`)
  console.log(`chat reliability: ${reliabilityFails.length ? `${reliabilityFails.length} failing` : 'pass'}`)

  process.exitCode = r.rules.pass === r.rules.total && !sessionFails.length && !voiceFails.length && !studyFails.length && !reliabilityFails.length && (!r.llm || r.llm.pass === r.llm.total) ? 0 : 1
} finally {
  await vite.close()
}
