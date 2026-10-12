import { useEffect, useState } from 'react'
import AiModeSelector from './AiModeSelector'
import { LocalAi, nativeErrorMessage, phoneAi, type NativeStatus } from '../lib/native-ai'

export default function AndroidAiSettings() {
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function setupModel() {
    setBusy(true); setError('')
    try { await phoneAi.prepare?.(); setStatus(await LocalAi.status()) }
    catch (failure) { setError(nativeErrorMessage(String((failure as { code?: string }).code ?? 'INVALID_MODEL'))) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let alive = true
    const update = () => { void LocalAi.status().then((value) => { if (alive) setStatus(value) }).catch(() => {}) }
    void setupModel(); update()
    const timer = setInterval(update, 500)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  async function importModel() {
    setBusy(true); setError('')
    try { setStatus(await LocalAi.importModel()) } catch (failure) { setError(nativeErrorMessage(String((failure as { code?: string }).code ?? 'INVALID_MODEL'))) }
    finally { setBusy(false) }
  }
  return <section className="mt-5 rounded-[18px] bg-ink/[0.035] p-4" aria-label="Android AI settings">
    <AiModeSelector />
    <div className="mt-3 text-[12px] text-ink-2" role="status">{status?.setup ? status.setup.stage === 'checking' ? 'Checking the included model…' : `Setting up Offline AI… ${Math.min(100, Math.round(status.setup.bytes / status.setup.total * 100))}%` : busy ? 'Preparing Offline AI…' : status?.model ? `Model ready · ${Math.round(status.model.bytes / 1_000_000)} MB${status.loaded ? ' · loaded' : ''}` : status && !status.available ? 'Offline AI is unavailable on this device.' : 'Offline AI is included. Retry setup to activate it.'}</div>
    {!status?.model && <button type="button" disabled={busy || status?.available === false} onClick={() => void setupModel()} className="press mt-2 rounded-full bg-tangerine px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">Retry setup</button>}
    {error && <p className="mt-2 text-[12px] text-rose-600" role="alert">{error}</p>}
    <details className="mt-3 text-[11px] text-ink-3"><summary>Model and prototype details</summary><p className="mt-2">Qwen2.5 0.5B Instruct · Q4_K_M GGUF · Apache 2.0. Included in this app and set up automatically. No separate download or model app needed. A small model: simple requests work best, and the app double-checks every change.</p><a className="underline" href="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF" target="_blank" rel="noreferrer">Source and license</a><button type="button" disabled={busy || status?.available === false} onClick={() => void importModel()} className="press block mt-2 underline disabled:opacity-50">Import a different model</button></details>
  </section>
}
