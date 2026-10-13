import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paldo-check-'))
try {
  for (const name of ['session', 'session-legacy', 'speech-profile', 'study-tools.test-cases']) {
    const file = `src/lib/${name}.ts`
    if (fs.existsSync(file)) fs.writeFileSync(path.join(dir, `${name}.js`), ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
  }
  const { runStudyToolTests } = createRequire(import.meta.url)(path.join(dir, 'study-tools.test-cases.js'))
  const failures = runStudyToolTests()
  failures.forEach(console.error)
  console.log(`study tools: ${failures.length ? failures.length + ' failing' : 'pass'}`)
  process.exitCode = failures.length ? 1 : 0
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
