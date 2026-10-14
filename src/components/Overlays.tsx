import SelectField from './SelectField'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { defaultHours } from '../lib/agent'
import { fmtDay, fmtHours, fmtTime, hoursOf, type CalEvent, type PalId, type TaskKind } from '../lib/core'
import { extractTitle, parseWhen, taskKind } from '../lib/parse'
import type { Energy } from '../lib/schedule'
import { Pal, PALS } from '../pals/Pal'
import { Boundary } from './Chat'
import { ChevronL, ChevronR, Glyph, SyllabusArt, Trash, Wordmark, X } from './Icons'
import { CLOUD_MODELS, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, getCloudModel, getLocalAiModel, hasCloudAi, getLocalAiUrl, getSavedGroqKey, isGroqDisabled, listOllamaModels, preloadOllama, setCloudModel, setGroqApiKey, setGroqDisabled, setLocalAiModel, setLocalAiUrl } from '../lib/groq'
import { playSound, setSoundsOn, soundsOn, testAlarm } from '../lib/notifications'
import AndroidAiSettings from './AndroidAiSettings'
import AiModeSelector from './AiModeSelector'
import { isPhoneAiPlatform } from '../lib/ai-mode'
import { HEARD_EVENT, lastHeard, wakeDetector } from '../lib/handsfree'

/* ---------- Pal stage: one character at a time, swipe or arrows ---------- */
const IDS = Object.keys(PALS) as PalId[]
export function PalStage({ pal, hello, onPick }: { pal: PalId; hello: PalId | null; onPick: (id: PalId) => void }) {
  const i = IDS.indexOf(pal)
  const [dir, setDir] = useState(1)
  const x0 = useRef<number | null>(null)
  const go = (d: number) => {
    setDir(d)
    onPick(IDS[(i + d + IDS.length) % IDS.length])
  }
  return (
    <div
      className="stage relative mt-12 flex touch-pan-y flex-col items-center select-none"
      data-time="afternoon"
      tabIndex={0}
      aria-roledescription="carousel"
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1) }}
      onPointerDown={(e) => { x0.current = e.clientX }}
      onPointerUp={(e) => {
        if (x0.current == null) return
        const dx = e.clientX - x0.current
        x0.current = null
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="relative flex h-[250px] w-full items-end justify-center">
        <button onClick={() => go(-1)} aria-label="Previous pal" className="press absolute top-1/2 left-0 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-ink/[0.05] text-ink-2 hover-lift hover:text-ink"><ChevronL /></button>
        <div key={pal} className="relative flex flex-col items-center" style={{ animation: `pal-in-${dir > 0 ? 'r' : 'l'} 420ms var(--ease-out) both` }}>
          {hello === pal && (
            <span className="pop absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-[12px] font-medium whitespace-nowrap text-paper">Hi, I'm {PALS[pal].name}!</span>
          )}
          <Pal id={pal} size={190} state={hello === pal ? 'wave' : 'idle'} float />
          <span className="mt-1 h-3 w-28 rounded-[50%] bg-ink/10 blur-[3px]" aria-hidden />
        </div>
        <button onClick={() => go(1)} aria-label="Next pal" className="press absolute top-1/2 right-0 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-ink/[0.05] text-ink-2 hover-lift hover:text-ink"><ChevronR /></button>
      </div>
      <div key={pal + 't'} className="view-in mt-3 text-center">
        <div className="font-serif text-[40px] leading-none tracking-[-0.02em]">{PALS[pal].name}</div>
        <div className="mt-1.5 text-[14px] text-ink-2">{PALS[pal].line} · <span className="text-ink-3">{PALS[pal].tone}</span></div>
      </div>
      <div className="mt-4 flex gap-1.5">
        {IDS.map((id, j) => (
          <button key={id} onClick={() => { setDir(j > i ? 1 : -1); onPick(id) }} aria-label={PALS[id].name} aria-current={id === pal} className="grid h-6 place-items-center px-0.5">
            <span className={`block h-1.5 rounded-full transition-all duration-300 ${id === pal ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20'}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------- Your PC's AI (Ollama): unlimited replies when the free cloud runs out ---------- */
const localModelLabel = (model: string) => /^(paldo-phone|qwen2\.5:1\.5b-instruct)(:latest)?$/.test(model) ? 'Qwen2.5 1.5B Instruct' : model

export function LocalAiRow() {
  const [on, setOn] = useState(() => Boolean(getLocalAiUrl()))
  const [url, setUrl] = useState(() => getLocalAiUrl() || DEFAULT_OLLAMA_URL)
  const [model, setModel] = useState(getLocalAiModel)
  // undefined = checking, null = not reachable
  const [models, setModels] = useState<string[] | null | undefined>(undefined)
  useEffect(() => {
    if (!on) return
    setModels(undefined)
    const id = setTimeout(async () => {
      const list = await listOllamaModels(url)
      setModels(list)
      // Keep the saved pick if it's installed, else the one that works well on a laptop, else the first
      if (list?.length && !list.includes(getLocalAiModel())) {
        const pick = list.includes(DEFAULT_OLLAMA_MODEL) ? DEFAULT_OLLAMA_MODEL : list[0]
        setModel(pick)
        setLocalAiModel(pick)
      }
      if (list?.length) preloadOllama()
    }, 400)
    return () => clearTimeout(id)
  }, [on, url])
  const status = !on ? 'Unlimited replies from Ollama on this computer when the free cloud AI runs out.'
    : models === undefined ? 'Checking…'
    : models === null ? `Ollama isn't reachable here. Start it${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '' : ' with OLLAMA_ORIGINS="*" ollama serve'}, then reopen settings.`
    : !models.length ? `Connected, but no models yet. Run: ollama pull ${DEFAULT_OLLAMA_MODEL}`
    : `Connected · ${localModelLabel(model)}. Takes over when the cloud AI runs out.${models.includes(DEFAULT_OLLAMA_MODEL) ? '' : ` Recommended: ollama pull ${DEFAULT_OLLAMA_MODEL}`}`
  const field = 'rounded-[12px] bg-ink/[0.045] px-3 py-1.5 font-mono text-[13px] outline-none focus:bg-ink/[0.08]'
  return (
    <div className="mt-4 rounded-[16px] bg-ink/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">Your PC's AI <span className="font-normal text-ink-3">(Ollama)</span></div>
          <div className="text-[11.5px] text-ink-3">{status}</div>
        </div>
        <button
          type="button"
          onClick={() => { setOn(!on); setLocalAiUrl(on ? '' : url) }}
          className={`press h-8 shrink-0 rounded-full px-3 text-[12px] font-medium ${on ? 'bg-accent/15 text-accent' : 'bg-paper text-ink shadow-sm hover:bg-paper-2'}`}
        >
          {on ? 'On' : 'Turn on'}
        </button>
      </div>
      {on && (
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setLocalAiUrl(e.target.value || DEFAULT_OLLAMA_URL) }}
            aria-label="Ollama address"
            className={`min-w-0 flex-1 ${field}`}
          />
          {models?.length ? (
            <SelectField value={model} onValueChange={v => { setModel(v); setLocalAiModel(v); preloadOllama() }} aria-label="Model" options={models.map(m => ({value:m,label:localModelLabel(m)}))} />
          ) : null}
        </div>
      )}
    </div>
  )
}

/* ---------- Reset app: back to a fresh install, after a second tap to be sure ---------- */
export function ResetRow() {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 6000)
    return () => clearTimeout(t)
  }, [sure])
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-rose-500/[0.06] p-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">Reset app</div>
        <div className="text-[11.5px] text-ink-3">{sure ? 'This erases your calendar, tasks, chats, study files and settings on this device.' : 'Start over like a fresh install. Downloaded AI models are kept.'}</div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => { if (!sure) return setSure(true); setBusy(true); void import('../lib/reset').then((m) => m.resetApp()) }}
        className={`press h-8 shrink-0 rounded-full px-3 text-[12px] font-medium disabled:opacity-50 ${sure ? 'bg-rose-600 text-white' : 'bg-paper text-rose-600 shadow-sm hover:bg-paper-2'}`}
      >
        {busy ? 'Resetting…' : sure ? 'Erase everything' : 'Reset'}
      </button>
    </div>
  )
}

/* ---------- Sounds: little blips for send, reply, added; alarms always ring ---------- */
function SoundsRow() {
  const [on, setOn] = useState(soundsOn)
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">Sounds</div>
        <div className="text-[11.5px] text-ink-3">Soft blips when you send, Pal replies, and plans are added. Timers and reminders always ring.</div>
      </div>
      <button type="button" onClick={() => { setSoundsOn(!on); setOn(!on); if (!on) playSound('added') }} className={`press h-8 shrink-0 rounded-full px-3 text-[12px] font-medium ${on ? 'bg-accent/15 text-accent' : 'bg-paper text-ink shadow-sm hover:bg-paper-2'}`}>
        {on ? 'On' : 'Off'}
      </button>
    </div>
  )
}

/* ---------- Hands-free "Hi {pal}": privacy in plain words, and the device-only switch ---------- */
export function HandsFreeRow({ palName, on, deviceOnly, setDeviceOnly, showDiagnostics = true }: { palName: string; on: boolean; deviceOnly: boolean; setDeviceOnly: (v: boolean) => void; showDiagnostics?: boolean }) {
  const [heard, setHeard] = useState(lastHeard)
  useEffect(() => {
    const update = () => setHeard(lastHeard())
    window.addEventListener(HEARD_EVENT, update)
    return () => window.removeEventListener(HEARD_EVENT, update)
  }, [])
  return (
    <div className="mt-4 rounded-[16px] bg-ink/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">Hands-free <span className="font-normal text-ink-3">("Hi {palName}")</span></div>
          <div className="text-[11.5px] text-ink-3">
            {`Always on: just say "Hi ${palName}". You'll hear a sound when the mic opens. It listens on this device; only what you say after "Hi ${palName}" leaves it${deviceOnly ? ' (with device-only on, nothing does)' : ''}.${isPhoneAiPlatform() ? ' Listens while the app is open.' : ''}`}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium ${on ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-ink/[0.06] text-ink-3'}`}>{on ? 'Listening' : 'Starting…'}</span>
      </div>
      <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={deviceOnly} onChange={(e) => setDeviceOnly(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
        <span>Write out what I say on this device only <span className="text-ink-3">(most private, but weaker with Taglish)</span></span>
      </label>
      {on && showDiagnostics && <div className="mt-2 text-[11.5px] text-ink-3">{wakeDetector() === 'engine' ? `Instant wake word: on (catches "Hi ${palName}" as you say it)` : 'Instant wake word: not loaded, the speech model listens for the name (a little slower)'}</div>}
      {on && showDiagnostics && heard && <div className="mt-1 text-[11.5px] text-ink-3">Last heard: <span className="font-mono text-ink-2">"{heard}"</span></div>}
    </div>
  )
}

/* ---------- Onboarding ---------- */
export function Onboarding({
  initial,
  onDone,
  onClose,
  onUserName,
  prefsLabel,
  onClearPrefs,
  handsFree,
  extras,
  onDemoWeek,
}: {
  initial?: { pal: PalId; name: string; energy: Energy; advancedMode?: boolean; userName?: string }
  onDone: (v: { pal: PalId; name: string; energy: Energy; advancedMode: boolean; userName?: string }) => void
  onClose?: () => void
  /** Saves the name as it's typed (when editing), like the key and Ollama rows: closing with ✕ keeps it */
  onUserName?: (name: string | undefined) => void
  /** "Nothing after 9pm · Sun free", or empty when nothing is remembered */
  prefsLabel?: string
  onClearPrefs?: () => void
  /** Hands-free "Hi {pal}" switch and its device-only setting */
  handsFree?: { on: boolean; deviceOnly: boolean; setDeviceOnly: (v: boolean) => void }
  /** On a phone the header has no room for these, so Settings holds them */
  extras?: { dark: boolean; toggleDark: () => void; onSyllabus: () => void }
  /** Advanced: put the sample week back */
  onDemoWeek?: () => void
}) {
  const isEditing = Boolean(initial)
  const [step, setStep] = useState(isEditing ? 1 : 0)
  const [pal, setPal] = useState<PalId>(initial?.pal ?? 'rei')
  const [name, setName] = useState(PALS[initial?.pal ?? 'rei'].name)
  const [energy, setEnergy] = useState<Energy>(initial?.energy ?? 'afternoon')
  const [advancedMode, setAdvancedMode] = useState<boolean>(initial?.advancedMode ?? false)
  // What the user wants to be called. Optional; it goes into the AI's facts so "hi jv" isn't mistaken for their name
  const [userName, setUserName] = useState(initial?.userName ?? '')
  const [hello, setHello] = useState<PalId | null>(null)
  const [groqKey, setGroqKey] = useState(getSavedGroqKey)
  const [cloudModel, setCloudModelState] = useState(getCloudModel)
  const [groqOff, setGroqOff] = useState(() => isGroqDisabled())
  const [alarmTesting, setAlarmTesting] = useState(false)
  const hasEnvKey = Boolean(import.meta.env.DEV && import.meta.env.VITE_GROQ_API_KEY)
  // Saved a moment after typing stops, so hands-free doesn't restart on every key
  useEffect(() => {
    if (!isEditing || !onUserName || userName.trim() === (initial?.userName ?? '')) return
    const t = setTimeout(() => onUserName(userName.trim() || undefined), 500)
    return () => clearTimeout(t)
  }, [userName]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hello) return
    const t = setTimeout(() => setHello(null), 1400)
    return () => clearTimeout(t)
  }, [hello])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-paper/55 p-4 pt-[max(56px,env(safe-area-inset-top))] sm:pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-2xl backdrop-saturate-150">
      <div className="pop relative w-full max-w-[720px]">
        <div className="flex items-center justify-between px-7 pt-1">
          <div className="flex items-center gap-3">
            <Wordmark className="text-[18px]" />
            {isEditing && (
              <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
                Preferences
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 2`}>
              {[0, 1].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-ink' : 'w-2 bg-ink/20 hover:bg-ink/40'}`}
                  aria-label={i === 0 ? 'Pal selection' : 'Ground rules & settings'}
                />
              ))}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="press -mr-2 grid size-8 place-items-center rounded-full text-ink-3 hover-lift hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {step === 0 ? (
          <div className="px-7 pt-3 pb-7">
            <h1 className="font-serif text-[40px] leading-[1.02] tracking-[-0.02em] sm:text-[48px]">Pick your pal.</h1>
            <PalStage pal={pal} hello={hello} onPick={(id) => { setPal(id); setName(PALS[id].name); setHello(id) }} />
            <div className="mt-5 flex justify-end">
              <button onClick={() => setStep(1)} className="press h-11 rounded-full bg-ink px-6 text-[15px] font-medium text-paper">Continue with {PALS[pal].name}</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 px-7 pt-6 pb-7 sm:grid-cols-[1fr_200px]">
            <div>
              <h1 className="font-serif text-[40px] leading-[1.02] tracking-[-0.02em]">A few ground rules.</h1>
              <p className="mt-2 text-[15px] text-ink-2">Your calendar stays on this device. When the AI Brain is on, {name || PALS[pal].name} sends a short summary of your schedule to answer you.</p>
              <div className="mt-5"><Boundary name={name || PALS[pal].name} /></div>
              <div className="mt-5">
                <label htmlFor="user-name" className="text-[12px] font-medium text-ink-3">What should {name || PALS[pal].name} call you?</label>
                <input
                  id="user-name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value.slice(0, 30))}
                  placeholder="Your name or nickname (optional)"
                  autoComplete="given-name"
                  className="mt-1.5 w-full max-w-[320px] rounded-[14px] bg-ink/[0.045] px-3.5 py-2 text-[16px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08] sm:text-[14px]"
                />
                <div className="mt-1 text-[11px] text-ink-3">Kept on this device and sent with your messages so {name || PALS[pal].name} can use it.</div>
              </div>
              <div className="mt-5">
                <div className="text-[12px] font-medium text-ink-3">When do you focus best?</div>
                <div className="mt-1.5 inline-flex rounded-full bg-paper-3 p-1">
                  {(['morning', 'afternoon', 'evening'] as Energy[]).map((v) => (
                    <button key={v} onClick={() => setEnergy(v)} className={`press h-8 rounded-full px-3.5 text-[13px] capitalize transition-colors ${energy === v ? 'bg-paper font-medium shadow-sm' : 'text-ink-2'}`}>{v}</button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-[12px] font-medium text-ink-3">
                  <div className="flex items-center gap-1.5">
                    <span>Your own Groq key <span className="font-normal">(optional)</span></span>
                    {hasEnvKey && !groqKey && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        Active from .env
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isPhoneAiPlatform() && <button
                      type="button"
                      onClick={() => { setGroqOff(!groqOff); setGroqDisabled(!groqOff) }}
                      className={`press rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${groqOff ? 'bg-ink/10 text-ink-2' : 'bg-accent/15 text-accent'}`}
                    >
                      {groqOff ? 'Off (local only)' : 'On'}
                    </button>}
                    <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Free API key ↗</a>
                  </div>
                </div>
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => {
                    const k = e.target.value
                    setGroqKey(k)
                    setGroqApiKey(k)
                  }}
                  placeholder={hasEnvKey ? "Using key from .env (paste here to override)" : hasCloudAi() ? "gsk_… (blank = Pal's shared free AI)" : "gsk_… (blank = simple offline rules)"}
                  className="mt-1.5 w-full rounded-[14px] bg-ink/[0.045] px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08]"
                />
                {!groqKey && !hasCloudAi() && !hasEnvKey && (
                  <div className="mt-2 rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] leading-snug text-ink-2">
                    <span className="font-medium text-ink">Want fast, smart replies?</span> Paste a free Groq key above: answers in 1–2 seconds instead of waiting on this device's AI.{' '}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="font-medium text-accent underline">Get a key</a>
                  </div>
                )}
                <div className="mt-1 text-[11px] text-ink-3">
                  {groqKey ? 'Your key: no daily limit from Pal. ' : hasCloudAi() ? "Without a key, Pal's free cloud AI is shared by everyone and has a daily limit. " : ''}Cloud: <span className="font-mono text-ink-2">{cloudModel === 'auto' ? `qwen3.8-27b → gpt-oss → ${groqKey ? '' : 'Gemini Flash-Lite → '}` : `${CLOUD_MODELS.find((m) => m.id === cloudModel)?.label} only → `}</span>{isPhoneAiPlatform() ? 'this phone (Auto)' : "your PC's AI · then simple rules"}
                </div>
                <select
                  value={cloudModel}
                  onChange={(e) => { setCloudModelState(e.target.value); setCloudModel(e.target.value) }}
                  aria-label="Cloud model"
                  className="mt-1.5 w-full rounded-[12px] bg-ink/[0.045] px-3 py-1.5 text-[12px] outline-none focus:bg-ink/[0.08]"
                >
                  <option value="auto">Cloud model: Auto (best available, falls back when one runs out)</option>
                  {CLOUD_MODELS.filter((m) => !groqKey || m.id !== 'gemini').map((m) => <option key={m.id} value={m.id}>Only {m.label} (for testing, no fallback)</option>)}
                </select>
              </div>

              {isPhoneAiPlatform() ? <AndroidAiSettings /> : <><div className="mt-5 rounded-[18px] bg-ink/[0.035] p-4"><AiModeSelector /></div><LocalAiRow /></>}
              {handsFree && <HandsFreeRow palName={name || PALS[pal].name} {...handsFree} />}
              <SoundsRow />
              {extras && (
                <div className="mt-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                  <button type="button" onClick={extras.toggleDark} className="press flex items-center justify-between gap-2 rounded-[16px] bg-ink/[0.035] p-3 text-left">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">Appearance</span>
                      <span className="block text-[11.5px] text-ink-3">{extras.dark ? 'Dark' : 'Light'}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-paper px-2.5 py-1 text-[11.5px] font-medium text-ink shadow-sm">{extras.dark ? 'Light' : 'Dark'}</span>
                  </button>
                  <button type="button" onClick={extras.onSyllabus} className="press flex items-center justify-between gap-2 rounded-[16px] bg-ink/[0.035] p-3 text-left">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">Syllabus</span>
                      <span className="block text-[11.5px] text-ink-3">Pull out deadlines</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-paper px-2.5 py-1 text-[11.5px] font-medium text-ink shadow-sm">Paste</span>
                  </button>
                </div>
              )}

              {prefsLabel && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">Remembered</div>
                    <div className="text-[11.5px] text-ink-3">{prefsLabel}</div>
                  </div>
                  {onClearPrefs && (
                    <button type="button" onClick={onClearPrefs} className="press h-8 shrink-0 rounded-full px-3 text-[12px] font-medium text-ink-2 hover:bg-paper-3">
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Advanced Mode Toggle */}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <span>Advanced Mode</span>
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">HUD</span>
                  </div>
                  <div className="text-[11.5px] text-ink-3">Show live AI model, online/offline status, and response latency on interface</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdvancedMode(!advancedMode)}
                  className={`press relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${advancedMode ? 'bg-ink' : 'bg-ink/15'}`}
                  role="switch"
                  aria-checked={advancedMode}
                  aria-label="Toggle Advanced Mode"
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-paper shadow ring-0 transition duration-200 ease-in-out ${advancedMode ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">Offline Alarm Check</div>
                  <div className="text-[11.5px] text-ink-3">Schedule a 5-second test alarm</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setAlarmTesting(true)
                    await testAlarm(name || PALS[pal].name, 5)
                    setTimeout(() => setAlarmTesting(false), 5500)
                  }}
                  disabled={alarmTesting}
                  className="press h-8 shrink-0 whitespace-nowrap rounded-full bg-paper px-3 text-[12px] font-medium text-ink shadow-sm hover:bg-paper-2 disabled:opacity-50"
                >
                  {alarmTesting ? 'Ringing in 5s...' : 'Test Alarm'}
                </button>
              </div>
              {advancedMode && onDemoWeek && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">Sample week</div>
                    <div className="text-[11.5px] text-ink-3">Replace your calendar with the demo week</div>
                  </div>
                  <button type="button" onClick={onDemoWeek} className="press h-8 shrink-0 rounded-full bg-paper px-3 text-[12px] font-medium text-ink shadow-sm hover:bg-paper-2">Load</button>
                </div>
              )}
              <ResetRow />
            </div>
            <div className="flex flex-col items-center justify-end gap-4">
              <Pal id={pal} size={130} state="cheer" />
              <div className="flex w-full gap-2">
                <button onClick={() => setStep(0)} className="press h-11 rounded-full px-4 text-[15px] text-ink-2 hover:bg-paper-3">Back</button>
                <button onClick={() => onDone({ pal, name: name.trim() || PALS[pal].name, energy, advancedMode, userName: userName.trim() || undefined })} className="press h-11 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">{isEditing ? 'Save Changes' : 'Save & Start'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Syllabus paste ---------- */
function Sheet({ children, titleId, onClose, className = '' }: { children: React.ReactNode; titleId: string; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(
    <dialog ref={ref} className={`app-sheet liquid-solid text-ink ${className}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose()
      }}>{children}</dialog>, document.body,
  )
}

export interface SyllabusItem { title: string; kind: TaskKind; due: number; hours: number; on: boolean }

/** The dated deadlines in a syllabus, course outline or timeline: one per line ("Quiz 2 on Oct 20", "Paper due Nov 3") */
export function scanDeadlines(text: string, now: number): SyllabusItem[] {
  const found: SyllabusItem[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\n|;|•/)) {
    if (line.length > 160) continue // a paragraph, not a timeline entry
    const k = taskKind(line) ?? (/\b(due|deadline|submit|submission|presentation|defen[cs]e|report|project|paper)\b/i.test(line) ? 'assignment' : null)
    const w = parseWhen(line, now)
    if (!k || !w) continue
    const title = extractTitle(line, k === 'exam' ? 'Exam' : 'Assignment')
    const key = `${title.toLowerCase()}|${w.t}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ title, kind: k, due: w.t, hours: defaultHours(k), on: true })
  }
  return found.sort((a, b) => a.due - b.due)
}

export function SyllabusSheet({ now, onClose, onAdd, initialText, source }: { now: number; onClose: () => void; onAdd: (items: SyllabusItem[]) => void; initialText?: string; source?: string }) {
  const [text, setText] = useState(initialText ?? '')
  // A file's text arrives already scanned: straight to the checklist
  const [items, setItems] = useState<SyllabusItem[] | null>(() => (initialText ? scanDeadlines(initialText, now) : null))
  const scan = () => setItems(scanDeadlines(text, now))
  return (
    <Sheet titleId="syllabus-title" onClose={onClose}>
      <div className="min-w-0">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 id="syllabus-title" className="font-serif text-[32px] leading-none tracking-[-0.02em]">{source ? 'Dates found' : 'Syllabus drop'}</h2>
            <p className="mt-1.5 text-[14px] text-ink-2">{source ? <>From <span className="font-medium text-ink">{source}</span>. Tick the ones to add to your schedule.</> : "Paste it in. You confirm every deadline before it's added."}</p>
          </div>
          <button onClick={onClose} className="press grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-paper-3" aria-label="Close"><X /></button>
        </div>
        {!items ? (
          <>
            <SyllabusArt className="mx-auto my-4 h-20 text-ink-3" />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={'Week 6 — Quiz 2 on Oct 20\nResearch paper due Nov 3\nMidterm exam Nov 10 9am'}
              className="w-full resize-none rounded-[18px] bg-ink/[0.045] p-3.5 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-ink-3 focus:bg-ink/[0.07]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setText('Quiz 2 on Oct 20\nResearch paper due Nov 3\nMidterm exam Nov 10 9am\nLab report due Oct 24 5pm')} className="press h-10 rounded-full px-4 text-[14px] text-ink-2 hover:bg-paper-3">Use sample</button>
              <button onClick={scan} disabled={!text.trim()} className="press h-10 rounded-full bg-ink px-5 text-[14px] font-medium text-paper disabled:opacity-30">Find deadlines</button>
            </div>
          </>
        ) : (
          <>
            <ul className="mt-4 max-h-[50vh] space-y-1 overflow-y-auto">
              {items.length === 0 && <li className="py-6 text-center text-[14px] text-ink-3">{source ? 'No dated deadlines in this file. You can paste them instead.' : 'No dated deadlines found. Each line needs a task and a date.'}</li>}
              {items.map((it, i) => {
                const G = it.kind === 'exam' ? Glyph.exam : Glyph.work
                return (
                  <li key={i}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-paper-2">
                      <input type="checkbox" checked={it.on} onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} className="size-4 accent-[var(--accent)]" />
                      <G className="size-4 text-ink-3" />
                      <span className="flex-1 truncate text-[14px] font-medium">{it.title}</span>
                      <span className="tnum text-[12.5px] text-ink-2">{fmtDay(it.due)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setItems(null)} className="press h-10 rounded-full px-4 text-[14px] text-ink-2 hover:bg-paper-3">Back</button>
              <button onClick={() => onAdd(items.filter((x) => x.on))} disabled={!items.some((x) => x.on)} className="press h-10 rounded-full bg-ink px-5 text-[14px] font-medium text-paper disabled:opacity-30">
                Add {items.filter((x) => x.on).length} deadline{items.filter((x) => x.on).length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

/* ---------- Block popover (grows from the block) ---------- */
const KIND_LABEL: Record<string, string> = { class: 'Class', shift: 'Work shift', exam: 'Exam', work: 'Planned work', commute: 'Transportation', protected: 'Protected time', deadline: 'Deadline' }

export function BlockPopover({ ev, rect, onClose, onDone, onAccept, onDelete, onEdit }: { onEdit?:()=>void; ev: CalEvent; rect: DOMRect; onClose: () => void; onDone: () => void; onAccept: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: rect.right + 8, top: rect.top, origin: 'left top' })
  useLayoutEffect(() => {
    const place = () => {
      const panel = ref.current
      if (!panel) return
      const viewport = window.visualViewport
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      panel.style.maxHeight = `${Math.max(0, height - 16)}px`
      panel.style.maxWidth = `${Math.max(0, width - 16)}px`
      const w = panel.offsetWidth, h = panel.offsetHeight
      const right = rect.right + 8 + w <= x + width - 8
      const left = Math.max(x + 8, Math.min(right ? rect.right + 8 : rect.left - 8 - w, x + width - w - 8))
      const top = Math.max(y + 8, Math.min(rect.top, y + height - h - 8))
      setPos({ left, top, origin: right ? 'left top' : 'right top' })
    }
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [rect])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const G = Glyph[ev.kind]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-label={ev.title} className="pop event-popover fixed z-50 w-[280px] overflow-y-auto overscroll-contain rounded-[22px] liquid-solid p-4" style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-3 uppercase">
          <G className="size-3" /> {ev.status === 'proposed' ? 'Suggested' : KIND_LABEL[ev.kind]} {ev.seg && `· ${ev.seg}`}
        </div>
        <div className="mt-1 text-[17px] leading-tight font-semibold tracking-[-0.01em]">{ev.title}</div>
        <div className="tnum mt-1 text-[13px] text-ink-2">
          {fmtDay(ev.start)} · {ev.kind === 'deadline' ? `due ${fmtTime(ev.start)}` : `${fmtTime(ev.start)} – ${fmtTime(ev.end)} (${fmtHours(hoursOf(ev))})`}
        </div>
        {ev.note && <div className="mt-2 text-[13px] font-medium text-accent whitespace-pre-wrap break-words">{ev.note}</div>}
        {ev.why && (
          <div className="mt-3 rounded-[12px] bg-paper-2 p-2.5 text-[12.5px] leading-snug text-ink-2">
            <span className="font-medium text-ink">Why here: </span>{ev.why}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1">{onEdit&&<button className="press min-h-11 rounded-full px-3 text-sm text-accent" onClick={onEdit}>Edit schedule</button>}
          {ev.status === 'proposed' && <button onClick={onAccept} className="press h-8 rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper">Accept</button>}
          {ev.kind === 'work' && (ev.status === 'planned' || ev.status === 'missed') && (
            <button onClick={onDone} className="press h-8 rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper">Mark done</button>
          )}
          <button onClick={onDelete} className="press h-8 rounded-full px-3.5 text-[13px] text-ink-2 hover:bg-paper-3">Delete</button>
        </div>
      </div>
    </>
  )
}

/* ---------- Toasts ---------- */
export interface Toast { id: string; text: string; pal?: PalId; action?: { label: string; fn: () => void } }

export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div className="app-toasts pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <ToastItem key={t.id} t={t} dismiss={dismiss} />
      ))}
    </div>
  )
}
function ToastItem({ t, dismiss }: { t: Toast; dismiss: (id: string) => void }) {
  useEffect(() => {
    const i = setTimeout(() => dismiss(t.id), 5000)
    return () => clearTimeout(i)
  }, [t.id, dismiss])
  return (
    <div className="pop app-toast pointer-events-auto flex max-w-full items-center gap-3 rounded-[20px] bg-ink py-1.5 pr-1.5 pl-2 text-[13.5px] text-paper shadow-[var(--shadow-lg)]">
      {t.pal ? <Pal id={t.pal} size={24} state="alert" /> : <span className="ml-1.5 size-1.5 rounded-[2px] bg-accent" />}
      <span className="min-w-0 flex-1 break-words py-1 pr-1">{t.text}</span>
      {t.action ? (
        <button onClick={() => { t.action!.fn(); dismiss(t.id) }} className="press min-h-11 shrink-0 rounded-full bg-paper/15 px-3 text-[12.5px] font-medium">{t.action.label}</button>
      ) : (
        <span className="w-1.5" />
      )}
    </div>
  )
}

/* ---------- Delete all plans (type "Delete" to confirm) ---------- */
export function DeletePlansSheet({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: () => void }) {
  const [text, setText] = useState('')
  const ok = text === 'Delete'
  return (
    <Sheet titleId="delete-plans-title" onClose={onClose} className="delete-sheet">
      <div className="min-w-0">
        <div className="flex items-start justify-between">
          <div className="grid size-11 place-items-center rounded-full bg-red-500/15 text-red-500"><Trash className="size-5" /></div>
          <button onClick={onClose} className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-paper-3" aria-label="Close"><X /></button>
        </div>
        <h2 id="delete-plans-title" className="mt-3 font-serif text-[30px] leading-none tracking-[-0.02em]">Delete all plans?</h2>
        <p className="mt-2 text-[14px] text-ink-2">This clears {count} calendar block{count === 1 ? '' : 's'} and every deadline from your planner. You can undo right after.</p>
        <label className="mt-4 block text-[12px] font-medium text-ink-3">
          Type <span className="font-semibold text-red-500">Delete</span> to confirm
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) onConfirm() }}
            placeholder="Delete"
            className={`mt-1.5 w-full rounded-[14px] bg-ink/[0.045] px-3.5 py-2 text-[14px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08] ${ok ? 'text-red-500 ring-1 ring-red-500/50' : ''}`}
          />
        </label>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="press h-11 flex-1 rounded-full text-[15px] text-ink-2 hover:bg-paper-3">Cancel</button>
          <button disabled={!ok} onClick={onConfirm} className="press h-11 flex-1 rounded-full bg-red-600 text-[15px] font-medium text-white transition-opacity disabled:opacity-35">Delete everything</button>
        </div>
      </div>
    </Sheet>
  )
}
