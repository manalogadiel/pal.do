// Scores Pal's conversation behaviour. See src/lib/chat.eval.ts for the cases.
//   pnpm eval:chat                          rules engine only (offline, must be 100%)
//   GROQ_API_KEY=gsk_... pnpm eval:chat --llm   also score the online model
import { createServer } from 'vite'

const llm = process.argv.includes('--llm')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { runEval } = await vite.ssrLoadModule('/src/lib/chat.eval.ts')
  const r = await runEval({ llm, apiKey: process.env.GROQ_API_KEY })
  console.log(`\nrules: ${r.rules.pass}/${r.rules.total}${r.llm ? `   model: ${r.llm.pass}/${r.llm.total}` : ''}`)
  process.exitCode = r.rules.pass === r.rules.total ? 0 : 1
} finally {
  await vite.close()
}
