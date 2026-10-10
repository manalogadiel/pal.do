import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { defaultHours } from '../lib/agent'
import { fmtDay, fmtHours, fmtTime, hoursOf, type CalEvent, type PalId, type TaskKind } from '../lib/core'
import { extractTitle, parseWhen, taskKind } from '../lib/parse'
import type { Energy } from '../lib/schedule'
import { Pal, PALS } from '../pals/Pal'
import { Boundary } from './Chat'
import { ChevronL, ChevronR, Glyph, SyllabusArt, Trash, Wordmark, X } from './Icons'
import { getSavedGroqKey, isGroqDisabled, setGroqApiKey, setGroqDisabled } from '../lib/groq'
import { testAlarm } from '../lib/notifications'

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

/* ---------- Onboarding ---------- */
export function Onboarding({
  initial,
  onDone,
  onClose,
  brain,
  onBrain,
  prefsLabel,
  onClearPrefs,
}: {
  initial?: { pal: PalId; name: string; energy: Energy; advancedMode?: boolean }
  onDone: (v: { pal: PalId; name: string; energy: Energy; advancedMode: boolean }) => void
  onClose?: () => void
  /** null = not downloaded, -1 = no WebGPU, 0..1 = progress */
  brain?: number | null
  onBrain?: () => void
  /** "Nothing after 9pm · Sun free", or empty when nothing is remembered */
  prefsLabel?: string
  onClearPrefs?: () => void
}) {
  const isEditing = Boolean(initial)
  const [step, setStep] = useState(isEditing ? 1 : 0)
  const [pal, setPal] = useState<PalId>(initial?.pal ?? 'rei')
  const [name, setName] = useState(PALS[initial?.pal ?? 'rei'].name)
  const [energy, setEnergy] = useState<Energy>(initial?.energy ?? 'afternoon')
  const [advancedMode, setAdvancedMode] = useState<boolean>(initial?.advancedMode ?? false)
  const [hello, setHello] = useState<PalId | null>(null)
  const [groqKey, setGroqKey] = useState(getSavedGroqKey)
  const [groqOff, setGroqOff] = useState(() => isGroqDisabled())
  const [alarmTesting, setAlarmTesting] = useState(false)
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
                <div className="text-[12px] font-medium text-ink-3">When do you focus best?</div>
                <div className="mt-1.5 inline-flex rounded-full bg-paper-3 p-1">
                  {(['morning', 'afternoon', 'evening'] as Energy[]).map((v) => (
                    <button key={v} onClick={() => setEnergy(v)} className={`press h-8 rounded-full px-3.5 text-[13px] capitalize transition-colors ${energy === v ? 'bg-paper font-medium shadow-sm' : 'text-ink-2'}`}>{v}</button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-[12px] font-medium text-ink-3">
                  <span>AI Brain (Groq API)</span>
                  <button
                    onClick={() => { setGroqOff(!groqOff); setGroqDisabled(!groqOff) }}
                    className={`press rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${groqOff ? 'bg-ink/10 text-ink-2' : 'bg-tangerine/15 text-tangerine'}`}
                  >
                    {groqOff ? 'Off (local only)' : 'On'}
                  </button>
                  <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-tangerine hover:underline">Free API key ↗</a>
                </div>
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => {
                    const k = e.target.value
                    setGroqKey(k)
                    setGroqApiKey(k)
                  }}
                  placeholder="gsk_... (optional, blank = offline rules)"
                  className="mt-1.5 w-full rounded-[14px] bg-ink/[0.045] px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08]"
                />
                <div className="mt-1 text-[11px] text-ink-3">
                  Primary: <span className="font-mono text-ink-2">qwen3.8-27b</span> · Fallback: <span className="font-mono text-ink-2">gpt-oss-20b</span> · Offline: <span className="font-mono text-ink-2">Qwen2.5 1.5B</span>
                </div>
              </div>

              {/* Offline brain: explicit opt-in, it's a ~1 GB download */}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-ink/[0.035] p-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">Offline brain</div>
                  <div className="text-[11.5px] text-ink-3">
                    {brain == null ? 'Smarter replies with no internet. One-time ~1 GB download, best on Wi-Fi.'
                      : brain < 0 ? "This browser doesn't support WebGPU, so offline replies use the rule engine."
                      : brain >= 1 ? 'Ready. Works without internet.'
                      : `Downloading… ${Math.round(brain * 100)}%`}
                  </div>
                  {brain != null && brain >= 0 && brain < 1 && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
                      <div className="h-full rounded-full bg-tangerine transition-[width] duration-500" style={{ width: `${Math.round(brain * 100)}%` }} />
                    </div>
                  )}
                </div>
                {brain == null && onBrain && (
                  <button type="button" onClick={onBrain} className="press h-8 shrink-0 rounded-full bg-paper px-3 text-[12px] font-medium text-ink shadow-sm hover:bg-paper-2">
                    Download
                  </button>
                )}
              </div>

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
              <div className="mt-4 flex items-center justify-between rounded-[16px] bg-ink/[0.035] p-3">
                <div>
                  <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <span>Advanced Mode</span>
                    <span className="rounded-full bg-tangerine/15 px-1.5 py-0.5 text-[10px] font-semibold text-tangerine">HUD</span>
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

              <div className="mt-4 flex items-center justify-between rounded-[16px] bg-ink/[0.035] p-3">
                <div>
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
                  className="press h-8 rounded-full bg-paper px-3 text-[12px] font-medium text-ink shadow-sm hover:bg-paper-2 disabled:opacity-50"
                >
                  {alarmTesting ? 'Ringing in 5s...' : 'Test Alarm'}
                </button>
              </div>
            </div>
            <div className="flex flex-col items-center justify-end gap-4">
              <Pal id={pal} size={130} state="cheer" />
              <div className="flex w-full gap-2">
                <button onClick={() => setStep(0)} className="press h-11 rounded-full px-4 text-[15px] text-ink-2 hover:bg-paper-3">Back</button>
                <button onClick={() => onDone({ pal, name: name.trim() || PALS[pal].name, energy, advancedMode })} className="press h-11 flex-1 rounded-full bg-ink text-[15px] font-medium text-paper">{isEditing ? 'Save Changes' : 'Save & Start'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Syllabus paste ---------- */
export interface SyllabusItem { title: string; kind: TaskKind; due: number; hours: number; on: boolean }

export function SyllabusSheet({ now, onClose, onAdd }: { now: number; onClose: () => void; onAdd: (items: SyllabusItem[]) => void }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<SyllabusItem[] | null>(null)
  const scan = () => {
    const found: SyllabusItem[] = []
    for (const line of text.split(/\n|;/)) {
      const k = taskKind(line)
      const w = parseWhen(line, now)
      if (k && w) found.push({ title: extractTitle(line, k === 'exam' ? 'Exam' : 'Assignment'), kind: k, due: w.t, hours: defaultHours(k), on: true })
    }
    setItems(found.sort((a, b) => a.due - b.due))
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/25 sm:place-items-center sm:p-4" onClick={onClose}>
      <div className="pop w-full max-w-[520px] rounded-t-[32px] liquid-solid p-6 sm:rounded-[32px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-[32px] leading-none tracking-[-0.02em]">Syllabus drop</h2>
            <p className="mt-1.5 text-[14px] text-ink-2">Paste it in. You confirm every deadline before it's added.</p>
          </div>
          <button onClick={onClose} className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-paper-3" aria-label="Close"><X /></button>
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
              {items.length === 0 && <li className="py-6 text-center text-[14px] text-ink-3">No dated deadlines found. Each line needs a task and a date.</li>}
              {items.map((it, i) => {
                const G = it.kind === 'exam' ? Glyph.exam : Glyph.work
                return (
                  <li key={i}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-paper-2">
                      <input type="checkbox" checked={it.on} onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} className="size-4 accent-[var(--tangerine)]" />
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
    </div>
  )
}

/* ---------- Block popover (grows from the block) ---------- */
const KIND_LABEL: Record<string, string> = { class: 'Class', shift: 'Work shift', exam: 'Exam', work: 'Planned work', commute: 'Commute', protected: 'Protected time', deadline: 'Deadline' }

export function BlockPopover({ ev, rect, onClose, onDone, onAccept, onDelete }: { ev: CalEvent; rect: DOMRect; onClose: () => void; onDone: () => void; onAccept: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: rect.right + 8, top: rect.top, origin: 'left top' })
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 280
    const h = ref.current?.offsetHeight ?? 160
    const right = rect.right + 8 + w < window.innerWidth
    const left = right ? rect.right + 8 : Math.max(8, rect.left - 8 - w)
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - h - 8)
    setPos({ left, top, origin: right ? 'left top' : 'right top' })
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
      <div ref={ref} role="dialog" className="pop fixed z-50 w-[280px] rounded-[22px] liquid-solid p-4" style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-3 uppercase">
          <G className="size-3" /> {ev.status === 'proposed' ? 'Suggested' : KIND_LABEL[ev.kind]} {ev.seg && `· ${ev.seg}`}
        </div>
        <div className="mt-1 text-[17px] leading-tight font-semibold tracking-[-0.01em]">{ev.title}</div>
        <div className="tnum mt-1 text-[13px] text-ink-2">
          {fmtDay(ev.start)} · {ev.kind === 'deadline' ? `due ${fmtTime(ev.start)}` : `${fmtTime(ev.start)} – ${fmtTime(ev.end)} (${fmtHours(hoursOf(ev))})`}
        </div>
        {ev.note && <div className="mt-2 text-[13px] font-medium text-tangerine">{ev.note}</div>}
        {ev.why && (
          <div className="mt-3 rounded-[12px] bg-paper-2 p-2.5 text-[12.5px] leading-snug text-ink-2">
            <span className="font-medium text-ink">Why here: </span>{ev.why}
          </div>
        )}
        <div className="mt-3 flex gap-1">
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
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
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
    <div className="pop pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-1.5 pr-1.5 pl-2 text-[13.5px] text-paper shadow-[var(--shadow-lg)]">
      {t.pal ? <Pal id={t.pal} size={24} state="alert" /> : <span className="ml-1.5 size-1.5 rounded-[2px] bg-tangerine" />}
      <span className="pr-1">{t.text}</span>
      {t.action ? (
        <button onClick={() => { t.action!.fn(); dismiss(t.id) }} className="press h-7 rounded-full bg-paper/15 px-3 text-[12.5px] font-medium">{t.action.label}</button>
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
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/25 sm:place-items-center sm:p-4" onClick={onClose}>
      <div className="pop w-full max-w-[420px] rounded-t-[32px] liquid-solid p-6 sm:rounded-[32px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="grid size-11 place-items-center rounded-full bg-red-500/15 text-red-500"><Trash className="size-5" /></div>
          <button onClick={onClose} className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-paper-3" aria-label="Close"><X /></button>
        </div>
        <h2 className="mt-3 font-serif text-[30px] leading-none tracking-[-0.02em]">Delete all plans?</h2>
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
    </div>
  )
}
