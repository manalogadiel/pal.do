import SelectField from './SelectField'
import { useEffect, useState } from 'react'
import AiModeSelector from './AiModeSelector'
import { LocalAi, nativeErrorMessage, phoneAi, type NativeModel, type NativeStatus } from '../lib/native-ai'

const field = 'rounded-[12px] bg-ink/[0.045] px-3 py-1.5 text-[12px] outline-none focus:bg-ink/[0.08]'

export default function AndroidAiSettings() {
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const [models, setModels] = useState<NativeModel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshModels = () => LocalAi.listModels?.().then((r) => setModels(r.models)).catch(() => {})
  async function run(action: () => Promise<NativeStatus | null | undefined>) {
    setBusy(true); setError('')
    try { const next = await action(); setStatus(next ?? await LocalAi.status()); await refreshModels() }
    catch (failure) { setError(nativeErrorMessage(String((failure as { code?: string }).code ?? 'INVALID_MODEL'))) }
    finally { setBusy(false) }
  }
  const setupModel = () => run(async () => { await phoneAi.prepare?.(); return null })
  useEffect(() => {
    let alive = true
    const update = () => { void LocalAi.status().then((value) => { if (alive) setStatus(value) }).catch(() => {}) }
    void setupModel(); update()
    const timer = setInterval(update, 500)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const importModel = () => run(() => LocalAi.importModel())
  const selected = models.find((m) => m.selected)
  return <section className="mt-5 rounded-[18px] bg-ink/[0.035] p-4" aria-label="Android AI settings">
    <AiModeSelector />
    <div className="mt-3 text-[12px] text-ink-2" role="status">{status?.setup ? status.setup.stage === 'checking' ? 'Checking the included model…' : `Setting up Offline AI… ${Math.min(100, Math.round(status.setup.bytes / status.setup.total * 100))}%` : busy ? 'Preparing Offline AI…' : status?.model ? `Model ready · ${status.model.name} · ${Math.round(status.model.bytes / 1_000_000)} MB${status.loaded ? ' · loaded' : ''}` : status && !status.available ? 'Offline AI is unavailable on this device.' : 'Offline AI is included. Retry setup to activate it.'}</div>
    {models.length > 1 && <div className="mt-2 flex items-center gap-2">
      <SelectField value={selected?.sha256 ?? ''} disabled={busy} onValueChange={v => void run(() => LocalAi.selectModel!({sha256:v}))} aria-label="Phone model" options={models.map(m => ({value:m.sha256,label:`${m.name}${m.bundled?' (included)':''} · ${Math.round(m.bytes/1_000_000)} MB`}))} />
    </div>}
    {models.some((m) => !m.selected && !m.bundled) && <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-3">
      {models.filter((m) => !m.selected && !m.bundled).map((m) => <button key={m.sha256} type="button" disabled={busy} onClick={() => void run(() => LocalAi.removeModel!({ sha256: m.sha256 }))} className="press underline disabled:opacity-50">Delete {m.name}</button>)}
    </div>}
    {!status?.model && <button type="button" disabled={busy || status?.available === false} onClick={() => void setupModel()} className="press mt-2 rounded-full bg-accent px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">Retry setup</button>}
    {error && <p className="mt-2 text-[12px] text-rose-600" role="alert">{error}</p>}
    <details className="mt-3 text-[11px] text-ink-3"><summary>Model and prototype details</summary><p className="mt-2">Qwen2.5 1.5B Instruct · Q4_K_M GGUF · Apache 2.0. Included in this app and set up automatically. No separate download or model app needed. Import another GGUF chat model (2B parameters or less) to compare, then switch between them above. The app double-checks every change.</p><a className="underline" href="https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF" target="_blank" rel="noreferrer">Source and license</a><button type="button" disabled={busy || status?.available === false} onClick={() => void importModel()} className="press block mt-2 underline disabled:opacity-50">Import a different model</button></details>
  </section>
}
