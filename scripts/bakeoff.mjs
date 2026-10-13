// Local model bake-off: speed and quality of each Ollama model on what people actually ask Pal.
//   node scripts/bakeoff.mjs qwen3.5:9b gemma4:e4b-it-qat …
// For each model: warm it up, time replies to the questions that go to the model (first words and total, through
// the app's real local path: same prompt, streaming, guards), then score it with the chat eval.
// Results go to stdout as a table; copy them into docs/local-model-comparison.md.
import { createServer } from 'vite'

const models = process.argv.slice(2)
if (!models.length) { console.error('usage: node scripts/bakeoff.mjs <ollama model> [...]'); process.exit(1) }
const URL = process.env.OLLAMA_URL || 'http://localhost:11434'

// What goes to the model (calendar facts questions are answered instantly by the app and aren't timed here)
const PROMPTS = [
  { pal: 'jaypee', text: 'hi jp', expect: (r) => !!r?.text && (!r.action || r.action.type === 'none') },
  { pal: 'rei', text: 'what schedule do you suggest for my rizal paper this week?', expect: (r) => !!r?.text },
  { pal: 'rei', text: 'can i squeeze in dinner with friends on friday?', expect: (r) => !!r?.text },
  { pal: 'rei', text: 'when should i sleep if my class is at 8am tomorrow?', expect: (r) => !!r?.text },
  { pal: 'rei', text: 'recommend a netflix show for tonight', expect: (r) => !!r?.text },
  { pal: 'rei', text: 'how do i balance my cafe shifts and classes?', expect: (r) => !!r?.text },
  { pal: 'jhyvie', text: 'pagod na ako sa dami ng gagawin', expect: (r) => !!r?.text && !/(depress|burn ?out|anxiety disorder)/i.test(r.text) },
  { pal: 'rei', text: 'will i pass my bio exam?', expect: (r) => !!r?.text && !/you will pass|you'll pass/i.test(r.text) },
]

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const g = await vite.ssrLoadModule('/src/lib/groq.ts')
  const { buildContext } = await vite.ssrLoadModule('/src/lib/context.ts')
  const { seedWeek } = await vite.ssrLoadModule('/src/lib/core.ts')
  const { runEval } = await vite.ssrLoadModule('/src/lib/chat.eval.ts')
  const now = Date.now()
  const { events, tasks } = seedWeek(now)
  const facts = buildContext(now, events, tasks, null, {})
  const rows = []
  for (const model of models) {
    g.useLocalAiForEval(URL, model)
    process.stdout.write(`\n== ${model}: warming up… `)
    await g.askGroq('hello', 'rei', '', now, [], facts, false, { provider: 'local' }).catch(() => null)
    const times = []
    let ok = 0
    for (const p of PROMPTS) {
      const t0 = performance.now()
      let first = null
      const r = await g.askGroq(p.text, p.pal, '', now, [], facts, false, { provider: 'local', onPartial: () => { first ??= performance.now() - t0 } }).catch(() => null)
      const total = performance.now() - t0
      times.push({ first: first ?? total, total })
      if (p.expect(r)) ok++
      process.stdout.write('.')
      if (process.env.SHOW) console.log(`\n  ${p.text} → ${r?.text ?? '(no reply)'} [${(total / 1000).toFixed(1)}s]`)
    }
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] / 1000 }
    process.stdout.write(' eval… ')
    const ev = await runEval({ llm: false, local: { url: URL, model }, log: () => {} })
    rows.push({ model, first: med(times.map((t) => t.first)), total: med(times.map((t) => t.total)), worst: Math.max(...times.map((t) => t.total)) / 1000, replay: `${ok}/${PROMPTS.length}`, eval: ev.llm ? `${ev.llm.pass}/${ev.llm.total}` : '-' })
    console.log('done')
  }
  console.log('\n| Model | First words (median) | Full reply (median) | Slowest | Replay | Chat eval |\n|---|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.model} | ${r.first.toFixed(1)} s | ${r.total.toFixed(1)} s | ${r.worst.toFixed(1)} s | ${r.replay} | ${r.eval} |`)
} finally {
  await vite.close()
}
