// First run: the pals say hi, ask your name, you pick one, allow the mic and notifications, and the offline AI that fits
// this device installs while you watch. API keys and the rest live in Settings, never here.
import { useEffect, useRef, useState } from 'react'
import type { PalId } from '../lib/core'
import { isPhoneAiPlatform } from '../lib/ai-mode'
import { DEFAULT_OLLAMA_URL, FASTER_LOCAL, listOllamaModels, LOCAL_SPEED_BUDGET_S, measureOllama, preloadOllama, pullOllamaModel, recommendedOllamaModel, setLocalAiModel, setLocalAiUrl } from '../lib/groq'
import { LocalAi, nativeErrorMessage, phoneAi } from '../lib/native-ai'
import { requestNotificationPermission } from '../lib/notifications'
import { Pal, PALS } from '../pals/Pal'
import { Wordmark } from './Icons'
import { PalStage } from './Overlays'

type Step = 'intro' | 'name' | 'pal' | 'permissions' | 'ai' | 'ready'
const STEPS: Step[] = ['intro', 'name', 'pal', 'permissions', 'ai', 'ready']
const IDS: PalId[] = ['rei', 'diel', 'jhyvie', 'jaypee']
type Perm = 'unknown' | 'granted' | 'denied' | 'asking'
/** Where the offline AI runs: the Android app's own model, Ollama on a computer, or none (a phone's browser) */
type Ai = { where: 'phone' | 'pc' | 'none'; phase: 'checking' | 'installing' | 'ready' | 'missing' | 'error' | 'none'; progress?: number; model?: string; detail?: string }

const mobileBrowser = () => !isPhoneAiPlatform() && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

export default function Welcome({ onDone }: { onDone: (v: { pal: PalId; name: string; userName?: string; notify: boolean }) => void }) {
  const [step, setStep] = useState<Step>('intro')
  const [userName, setUserName] = useState('')
  const [pal, setPal] = useState<PalId>('rei')
  const [hello, setHello] = useState<PalId | null>(null)
  const [mic, setMic] = useState<Perm>('unknown')
  const [notify, setNotify] = useState<Perm>('unknown')
  const [ai, setAi] = useState<Ai>({ where: 'none', phase: 'checking' })
  const aiStarted = useRef(false)
  const at = STEPS.indexOf(step)
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, at + 1)])
  const back = () => setStep(STEPS[Math.max(0, at - 1)])
  const name = userName.trim()
  const palName = PALS[pal].name

  useEffect(() => {
    if (!hello) return
    const t = setTimeout(() => setHello(null), 1400)
    return () => clearTimeout(t)
  }, [hello])

  // What's already allowed, so the buttons say so instead of asking again
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
    perms?.query({ name: 'microphone' as PermissionName }).then((p) => p.state !== 'prompt' && setMic(p.state === 'granted' ? 'granted' : 'denied')).catch(() => {})
    if ('Notification' in window && Notification.permission !== 'default') setNotify(Notification.permission === 'granted' ? 'granted' : 'denied')
  }, [])

  async function askMic() {
    setMic('asking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMic('granted')
    } catch {
      setMic('denied')
    }
  }
  async function askNotify() {
    setNotify('asking')
    setNotify((await requestNotificationPermission()) ? 'granted' : 'denied')
  }

  // The offline AI that fits this device, installed once this step opens (it keeps going if they move on)
  useEffect(() => {
    if (step !== 'ai' || aiStarted.current) return
    aiStarted.current = true
    if (isPhoneAiPlatform()) {
      setAi({ where: 'phone', phase: 'checking' })
      const poll = setInterval(() => {
        LocalAi.status().then((s) => {
          if (s.setup) setAi({ where: 'phone', phase: 'installing', progress: s.setup.total ? s.setup.bytes / s.setup.total : 0, detail: s.setup.stage === 'checking' ? 'Checking the model…' : 'Copying the model…' })
          else if (s.model) { setAi({ where: 'phone', phase: 'ready', model: s.model.name, progress: 1, detail: `${Math.round(s.model.bytes / 1_000_000)} MB` }); clearInterval(poll) }
          else if (!s.available) { setAi({ where: 'phone', phase: 'none', detail: 'This phone can’t run the offline AI. Pal uses its cloud AI instead.' }); clearInterval(poll) }
        }).catch(() => {})
      }, 400)
      phoneAi.prepare?.().catch((e: { code?: string }) => { clearInterval(poll); setAi({ where: 'phone', phase: 'error', detail: nativeErrorMessage(String(e?.code ?? 'LOAD_FAILED')) }) })
      return
    }
    if (mobileBrowser()) { setAi({ where: 'none', phase: 'none' }); return }
    const model = recommendedOllamaModel()
    let stopped = false
    const run = async () => {
      setAi({ where: 'pc', phase: 'checking', model })
      for (;;) {
        if (stopped) return
        const list = await listOllamaModels(DEFAULT_OLLAMA_URL)
        if (list) {
          try {
            if (!list.includes(model)) {
              setAi({ where: 'pc', phase: 'installing', model, progress: 0, detail: 'Starting the download…' })
              await pullOllamaModel(DEFAULT_OLLAMA_URL, model, (progress, status) => setAi({ where: 'pc', phase: 'installing', model, progress, detail: /pulling|download/i.test(status) ? 'Downloading…' : status || 'Downloading…' }))
            }
            // A quick check that it answers in time on this machine; if not, the faster model instead
            let use = model
            const faster = FASTER_LOCAL[model]
            if (faster) {
              setAi({ where: 'pc', phase: 'installing', model, progress: 1, detail: 'Checking how fast it runs here…' })
              const secs = await measureOllama(DEFAULT_OLLAMA_URL, model)
              if (secs != null && secs > LOCAL_SPEED_BUDGET_S) {
                use = faster
                if (!(await listOllamaModels(DEFAULT_OLLAMA_URL))?.includes(faster))
                  await pullOllamaModel(DEFAULT_OLLAMA_URL, faster, (progress) => setAi({ where: 'pc', phase: 'installing', model: faster, progress, detail: `${model} is slow on this computer (${secs.toFixed(1)} s), so a faster one…` }))
              }
            }
            setLocalAiUrl(DEFAULT_OLLAMA_URL)
            setLocalAiModel(use)
            preloadOllama()
            setAi({ where: 'pc', phase: 'ready', model: use, progress: 1, detail: use !== model ? `picked for speed on this computer` : undefined })
          } catch (e) {
            setAi({ where: 'pc', phase: 'error', model, detail: String((e as Error)?.message ?? e) })
          }
          return
        }
        setAi({ where: 'pc', phase: 'missing', model })
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
    void run()
    return () => { stopped = true }
  }, [step])

  const finish = () => onDone({ pal, name: palName, userName: name || undefined, notify: notify === 'granted' })

  return (
    <div className="welcome-screen fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-paper" data-step={step}>
      <div className="welcome-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="welcome-shell relative mx-auto flex min-h-[100dvh] w-full flex-col">
        <header className="welcome-header flex min-h-11 items-center justify-between gap-4">
          <Wordmark className="text-[18px]" />
          {step !== 'intro' && (
            <div className="flex gap-1.5" aria-label={`Step ${at} of ${STEPS.length - 1}`}>
              {STEPS.slice(1).map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i + 1 === at ? 'w-5 bg-ink' : i + 1 < at ? 'w-1.5 bg-ink/50' : 'w-1.5 bg-ink/15'}`} />)}
            </div>
          )}
        </header>

        <div className="welcome-layout">
          <aside className="welcome-companion" aria-label={step === 'intro' ? 'Meet your Pals' : `Your Pal, ${palName}`}>
            {step === 'intro' ? (
              <div className="welcome-intro-pals">
                {IDS.map((id, i) => (
                  <div key={id} className="welcome-rise" style={{ '--i': i } as React.CSSProperties}>
                    <IntroPal id={id} delay={900 + i * 180} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="welcome-selected-pal">
                <Pal id={step === 'name' ? 'rei' : pal} size={240} state={step === 'ready' ? 'cheer' : 'idle'} className="welcome-companion-pal" float />
                <p className="mt-5 font-serif text-[40px] leading-tight">{step === 'name' ? 'Rei' : palName}</p>
                <p className="mt-2 text-[15px] text-ink-2">{PALS[step === 'name' ? 'rei' : pal].line}</p>
              </div>
            )}
          </aside>
          <main key={step} className="welcome-step min-w-0 py-6">

          {step === 'intro' && (
            <div className="welcome-intro text-center">
              <h1 className="welcome-fade mt-8 font-serif text-[clamp(34px,9vw,52px)] leading-[1.02] tracking-[-0.02em]" style={{ '--d': '700ms' } as React.CSSProperties}>
                Hi! We’re your Pals.
              </h1>
              <p className="welcome-fade mx-auto mt-3 max-w-[420px] text-[15px] leading-relaxed text-ink-2" style={{ '--d': '900ms' } as React.CSSProperties}>
                Plan your day, keep up with deadlines and make time for what matters. Just talk to us.
              </p>
              <button onClick={next} className="welcome-fade press mt-8 h-12 w-full max-w-[320px] rounded-full bg-ink text-[16px] font-medium text-paper" style={{ '--d': '1100ms' } as React.CSSProperties}>
                Get started
              </button>
            </div>
          )}

          {step === 'name' && (
            <form onSubmit={(e) => { e.preventDefault(); next() }} className="text-center">
              <Pal id="rei" size={110} state={name ? 'happy' : 'talking'} className="welcome-inline-pal mx-auto" />
              <h1 className="mt-5 font-serif text-[clamp(30px,8vw,42px)] leading-[1.05] tracking-[-0.02em]">First, what should we call you?</h1>
              <input
                autoFocus
                value={userName}
                onChange={(e) => setUserName(e.target.value.slice(0, 30))}
                placeholder="Your name or nickname"
                autoComplete="given-name"
                enterKeyHint="next"
                className="mx-auto mt-6 block h-12 w-full max-w-[340px] rounded-[16px] bg-ink/[0.05] px-4 text-center text-[17px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08]"
              />
              <p className="mt-2 text-[12px] text-ink-3">Kept on this device. You can change it later.</p>
              <Nav onBack={back} next={<button type="submit" className="press h-12 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">{name ? `I’m ${name}` : 'Skip for now'}</button>} />
            </form>
          )}

          {step === 'pal' && (
            <div>
              <p className="text-center text-[15px] text-ink-2">{name ? `Nice to meet you, ${name}!` : 'Nice to meet you!'}</p>
              <h1 className="mt-1 text-center font-serif text-[clamp(30px,8vw,42px)] leading-[1.05] tracking-[-0.02em]">Pick your Pal.</h1>
              <PalStage pal={pal} hello={hello} onPick={(id) => { setPal(id); setHello(id) }} />
              <Nav onBack={back} next={<button onClick={next} className="press h-12 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">Continue with {palName}</button>} />
            </div>
          )}

          {step === 'permissions' && (
            <div>
              <div className="flex items-center gap-3">
                <Pal id={pal} size={64} state="talking" className="welcome-inline-pal" />
                <h1 className="font-serif text-[clamp(26px,7vw,36px)] leading-[1.05] tracking-[-0.02em]">A few permissions, so I can help</h1>
              </div>
              <div className="mt-5 space-y-2.5">
                <PermRow title="Microphone" body={`Talk to ${palName}, or just say “Hi ${palName}” hands-free.`} state={mic} onAllow={askMic} />
                <PermRow title="Notifications" body="Alarms, timers and reminders, even when the app is closed." state={notify} onAllow={askNotify} />
                <PermRow title="Files" body="Attach a syllabus, reviewer or notes. You pick each file; nothing else is read." state="granted" doneLabel="When you attach" />
              </div>
              <Nav onBack={back} next={<button onClick={next} className="press h-12 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">{mic === 'granted' && notify === 'granted' ? 'Continue' : 'Continue anyway'}</button>} />
            </div>
          )}

          {step === 'ai' && (
            <div>
              <div className="flex items-center gap-3">
                <Pal id={pal} size={64} className="welcome-inline-pal" state={ai.phase === 'ready' ? 'cheer' : ai.phase === 'installing' ? 'listening' : 'talking'} />
                <h1 className="font-serif text-[clamp(26px,7vw,36px)] leading-[1.05] tracking-[-0.02em]">{palName}’s offline brain</h1>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                {ai.where === 'none' ? `${palName} uses its cloud AI here.` : `So ${palName} still answers with no internet or when the free cloud runs out. Picked for this device:`}
              </p>
              <AiPanel ai={ai} palName={palName} />
              <Nav
                onBack={back}
                next={<button onClick={next} className="press h-12 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">{ai.phase === 'ready' || ai.phase === 'none' ? 'Continue' : ai.phase === 'installing' ? 'Continue (keeps installing)' : 'Skip for now'}</button>}
              />
            </div>
          )}

          {step === 'ready' && (
            <div className="text-center">
              <Pal id={pal} size={130} state="cheer" className="welcome-inline-pal mx-auto" float />
              <h1 className="mt-5 font-serif text-[clamp(30px,8vw,44px)] leading-[1.05] tracking-[-0.02em]">{name ? `You’re all set, ${name}!` : 'You’re all set!'}</h1>
              <ul className="mx-auto mt-5 max-w-[400px] space-y-2 text-left text-[14px] text-ink-2">
                <Tip>Tell {palName} about your week: “Bio exam Friday 3pm”.</Tip>
                <Tip>Turn on hands-free, then just say “Hi {palName}”.</Tip>
                <Tip>Attach a syllabus to add its dates, or notes to make flashcards.</Tip>
              </ul>
              <Nav onBack={back} next={<button onClick={finish} className="press h-12 flex-1 rounded-full bg-accent text-[16px] font-medium text-white shadow-[0_14px_30px_-12px_var(--accent)]">Start with {palName}</button>} />
            </div>
          )}
          </main>
        </div>
      </div>
    </div>
  )
}

/** One pal in the intro: still while it rises in, then waves */
function IntroPal({ id, delay }: { id: PalId; delay: number }) {
  const [state, setState] = useState<'idle' | 'wave'>('idle')
  useEffect(() => {
    const t = setTimeout(() => setState('wave'), delay)
    const u = setTimeout(() => setState('idle'), delay + 2200)
    return () => { clearTimeout(t); clearTimeout(u) }
  }, [delay])
  // Four across on a 320px phone, bigger on wider screens
  return <Pal id={id} size={88} state={state} className="welcome-intro-pal" />
}

function Nav({ onBack, next }: { onBack: () => void; next: React.ReactNode }) {
  return (
    <div className="welcome-nav mx-auto mt-8 flex w-full max-w-[400px] gap-2">
      <button type="button" onClick={onBack} className="press h-12 shrink-0 rounded-full px-5 text-[15px] text-ink-2 hover:bg-paper-3">Back</button>
      {next}
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-2.5 rounded-[14px] bg-ink/[0.035] px-3.5 py-2.5"><span className="text-accent">•</span><span className="min-w-0">{children}</span></li>
}

function PermRow({ title, body, state, onAllow, doneLabel }: { title: string; body: string; state: Perm; onAllow?: () => void; doneLabel?: string }) {
  return (
    <div className="welcome-permission flex items-center gap-3 rounded-[18px] bg-ink/[0.035] p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="text-[12.5px] leading-snug text-ink-3">{body}</div>
      </div>
      {doneLabel ? (
        <span className="shrink-0 text-right text-[11.5px] text-ink-3">{doneLabel}</span>
      ) : state === 'granted' ? (
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">Allowed</span>
      ) : (
        <button type="button" onClick={onAllow} disabled={state === 'asking'} className="press h-9 shrink-0 rounded-full bg-ink px-4 text-[13px] font-medium text-paper disabled:opacity-50">
          {state === 'asking' ? 'Asking…' : state === 'denied' ? 'Try again' : 'Allow'}
        </button>
      )}
    </div>
  )
}

function AiPanel({ ai, palName }: { ai: Ai; palName: string }) {
  if (ai.where === 'none' && ai.phase === 'none') return null
  const pct = Math.round((ai.progress ?? 0) * 100)
  const label = ai.where === 'phone' ? (ai.model ?? 'Qwen2.5 1.5B Instruct') : (ai.model ?? 'qwen3.5')
  return (
    <div className="mt-4 rounded-[18px] bg-ink/[0.035] p-4" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-ink">{label}</div>
          <div className="text-[12px] text-ink-3">{ai.where === 'phone' ? 'Runs on this phone' : 'Runs on this computer with Ollama'}</div>
        </div>
        {(ai.phase === 'installing' || ai.phase === 'ready') && <span className="tnum shrink-0 text-[13px] font-medium text-ink-2">{ai.phase === 'ready' ? 'Ready' : `${pct}%`}</span>}
      </div>
      {(ai.phase === 'installing' || ai.phase === 'ready' || ai.phase === 'checking') && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
          <div className={`h-full rounded-full transition-[width] duration-300 ${ai.phase === 'ready' ? 'bg-emerald-500' : 'bg-accent'} ${ai.phase === 'checking' ? 'welcome-indeterminate w-1/3' : ''}`} style={ai.phase === 'checking' ? undefined : { width: `${Math.max(3, pct)}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12.5px] leading-snug text-ink-2">
        {ai.phase === 'checking' && 'Checking this device…'}
        {ai.phase === 'installing' && (ai.detail ?? 'Installing…')}
        {ai.phase === 'ready' && `${palName} can now answer offline${ai.detail ? ` · ${ai.detail}` : ''}.`}
        {ai.phase === 'error' && (ai.detail ?? 'Setup didn’t finish. You can retry later in Settings.')}
        {ai.phase === 'none' && ai.detail}
      </p>
      {ai.phase === 'missing' && (
        <div className="mt-1 text-[12.5px] leading-snug text-ink-2">
          <p>
            Install <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="font-medium text-accent underline">Ollama</a> (free), open it, and this continues on its own.
            {!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && <> If it’s already running, start it with <code className="rounded bg-ink/[0.06] px-1">OLLAMA_ORIGINS="*" ollama serve</code>.</>}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-ink-3"><span className="pulse-dot size-1.5 rounded-full bg-accent" />Waiting for Ollama…</p>
        </div>
      )}
    </div>
  )
}
