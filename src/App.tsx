import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultHours, say, turn, type Awaiting, type Card, type Draft, type PendingEvent } from './lib/agent'
import { addDays, DAY, fmtDay, fmtHours, fmtTime, HOUR, hoursOf, MIN, seedWeek, startOfDay, startOfWeek, uid, type CalEvent, type PalId, type PalState, type Task } from './lib/core'
import { freeGaps, propose, type Energy, type Prefs } from './lib/schedule'
import { buildContext } from './lib/context'
import { getCachedWeather, refreshWeather, weatherLine, type Weather } from './lib/weather'
import { Calendar, LoadStrip } from './components/Calendar'
import { Chat, type Msg, type MascotBubble } from './components/Chat'
import { BlockPopover, DeletePlansSheet, Onboarding, SyllabusSheet, Toasts, type SyllabusItem, type Toast } from './components/Overlays'
import { ChevronL, ChevronR, Clock, Gear, Moon, Sun, Trash, Wordmark } from './components/Icons'
import { Pal, PALS } from './pals/Pal'
import { Rail, TabBar, type View } from './components/Nav'
import { Today } from './components/Today'
import { Tasks } from './components/Tasks'
import { loadKokoro, speakKokoro, stopKokoro } from './lib/voice'
import { cancelSessionAlarms, enableAlarms, notifyWeb, playChime, scheduleSessionAlarms, syncEventAlarms, unlockChime } from './lib/notifications'
import { focusElapsed, fromSaved, isPaused, LONG_EVERY, pause, phaseEnds, phaseLabel, resume, skip, start, stop, tick, type Session } from './lib/session'
import { Study } from './components/Study'
import { askGroq, getGroqApiKey, hasCloudAi, parseIsoToLocalMs, PRIMARY_MODEL, type AiAction } from './lib/groq'
import { StatusBadge } from './components/StatusBadge'

const KEY = 'paldo-v1'
const QUIET: [number, number] = [23, 7]
const MAX_CHECKINS = 3
const VOICE_PITCH: Record<PalId, number> = { rei: 1.1, diel: 0.9, jhyvie: 1.3, jaypee: 1.05 }

interface Settings { pal: PalId; name: string; energy: Energy; onboarded: boolean; voiceOn: boolean; notify: boolean; notifyAsked: boolean; advancedMode?: boolean; prefs?: Prefs; lastBrief?: string }
interface Saved { settings: Settings; events: CalEvent[]; tasks: Task[]; msgs: Msg[]; asked: string[]; alerted: string[]; log: Record<string, number>; offset: number; session?: Session; focusLog?: Record<string, number> }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '')
    if (s?.settings) return { ...s, msgs: (s.msgs as Msg[]) || [] }
  } catch {}
  const { events, tasks } = seedWeek(Date.now())
  return {
    settings: { pal: 'rei', name: 'Rei', energy: 'afternoon', onboarded: false, voiceOn: false, notify: false, notifyAsked: false, advancedMode: false },
    events, tasks, msgs: [], asked: [], alerted: [], log: {}, offset: 0,
  }
}

/** Weekly repeats of a time slot, from this week forward. days: 0=Sun…6=Sat. */
function occurrences(start: number, end: number, days: number[], now: number, weeks = 8) {
  const s = new Date(start), dur = end - start
  const ws = startOfWeek(now), today = startOfDay(now)
  const out: { start: number; end: number }[] = []
  for (let w = 0; w < weeks; w++)
    for (const d of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
      const day = addDays(ws, w * 7 + ((d + 6) % 7))
      if (day < today) continue
      const t = new Date(day)
      t.setHours(s.getHours(), s.getMinutes(), 0, 0)
      out.push({ start: t.getTime(), end: t.getTime() + dur })
    }
  return out
}

const isQuiet = (t: number) => {
  const h = new Date(t).getHours()
  return h >= QUIET[0] || h < QUIET[1]
}

export default function App() {
  const init = useMemo(load, [])
  const [settings, setSettings] = useState(init.settings)
  const [events, setEvents] = useState(init.events)
  const [tasks, setTasks] = useState(init.tasks)
  const [msgs, setMsgs] = useState(init.msgs)
  // The pal's current line. Never persisted, never in the feed.
  const [bubble, setBubble] = useState<MascotBubble | null>(() => ({ id: uid(), mascotId: init.settings.pal, text: say(init.settings.pal, 'greet'), kind: 'greeting' }))
  const [asked, setAsked] = useState(init.asked)
  const [alerted, setAlerted] = useState(init.alerted)
  const [log, setLog] = useState(init.log)
  const [offset, setOffset] = useState(init.offset)
  const [clock, setClock] = useState(Date.now())
  const now = clock + offset

  const [draft, setDraft] = useState<Draft | null>(null)
  const [awaiting, setAwaiting] = useState<Awaiting>(null)
  const [pending, setPending] = useState<PendingEvent | null>(null)
  const [mood, setMood] = useState<{ state: PalState; until: number } | null>(null)
  const [typing, setTyping] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [interim, setInterim] = useState('')
  const [idleLong, setIdleLong] = useState(false)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<string[]>([])
  const [pop, setPop] = useState<{ ev: CalEvent; rect: DOMRect } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [activeModel, setActiveModel] = useState<string>(() => (hasCloudAi() ? PRIMARY_MODEL : 'Local Rules'))
  const [lastLatency, setLastLatency] = useState<number | null>(null)
  const [weather, setWeather] = useState<Weather | null>(getCachedWeather)
  const [lastIntent, setLastIntent] = useState<string>('')
  // In-browser model: null = not started, else download/compile progress 0..1
  const [brain, setBrain] = useState<number | null>(null)
  const brainStarted = useRef(false)
  const loadBrain = useCallback(async () => {
    if (brainStarted.current) return
    brainStarted.current = true
    const w = await import('./lib/webllm')
    if (!(await w.isWebGpuSupported())) { brainStarted.current = false; setBrain(-1); return }
    setBrain(0)
    w.setWebLlmProgressHandler((p) => setBrain(Math.min(p, 0.99)))
    const engine = await w.getWebLlmEngine()
    setBrain(engine ? 1 : null)
    if (!engine) brainStarted.current = false
  }, [])
  // Only auto-load when the ~1GB model is already cached: never surprise-download on mobile data
  useEffect(() => {
    const id = setTimeout(() => {
      import('./lib/webllm').then(async (w) => { if (await w.isModelCached()) loadBrain() }).catch(() => {})
    }, 3000)
    return () => clearTimeout(id)
  }, [loadBrain])
  // Keep today's weather warm so offline questions still get an answer
  useEffect(() => {
    const go = () => refreshWeather().then((w) => w && setWeather(w))
    go()
    const i = setInterval(go, 30 * MIN)
    window.addEventListener('online', go)
    return () => { clearInterval(i); window.removeEventListener('online', go) }
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const [syllabus, setSyllabus] = useState(false)
  const [editing, setEditing] = useState(false)
  const [weekOff, setWeekOff] = useState(0)
  const [dayIdx, setDayIdx] = useState((new Date().getDay() + 6) % 7)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  const [chatOpen, setChatOpen] = useState(false) // mobile drawer
  const [clearing, setClearing] = useState(false)
  const [collapsed, setCollapsed] = useState(false) // desktop bubble
  const [instant, setInstant] = useState(false) // keyboard toggles skip the morph
  const [view, setViewRaw] = useState<View>(() => (localStorage.getItem('paldo.view') as View) || 'home')
  const setView = (v: View) => {
    setViewRaw(v)
    localStorage.setItem('paldo.view', v)
    // Week gets the full width; the pal tucks into its bubble
    setInstant(false)
    setCollapsed(v === 'week')
  }

  const [dark, setDark] = useState(() => localStorage.getItem('paldo.theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('paldo.theme', dark ? 'dark' : 'light')
  }, [dark])
  const themeBtn = (
    <button onClick={() => setDark((d) => !d)} className="press grid size-10 place-items-center rounded-full text-ink-2" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <span key={String(dark)} className="pop">{dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</span>
    </button>
  )

  const ev = useRef(events)
  ev.current = events
  const tk = useRef(tasks)
  tk.current = tasks
  const nowRef = useRef(now)
  nowRef.current = now
  const { pal } = settings
  const palRef = useRef(pal)
  palRef.current = pal
  const name = PALS[pal].name // names are fixed per pal

  /* ---------- study session (Pomodoro). Lives here, not in the tab, so switching tabs never stops it ---------- */
  // Not ticked yet: the reconcile effect below catches up time spent closed, so those minutes get logged
  const [session, setSession] = useState<Session>(() => fromSaved(init.session))
  const [focusLog, setFocusLog] = useState<Record<string, number>>(() => init.focusLog ?? {})
  // The pal's latest session line, shown on the Study screen (the chat bubble is hidden while the chat log is open)
  const [studyLine, setStudyLine] = useState('')
  const sessionRef = useRef(session)
  sessionRef.current = session
  const todayFocus = focusLog[new Date().toDateString()] ?? 0
  const logFocus = (ms: number) => {
    const min = Math.round(ms / 60_000)
    if (min <= 0) return
    const day = new Date().toDateString()
    setFocusLog((l) => ({ ...l, [day]: (l[day] ?? 0) + min }))
  }
  // The view as of now, for callbacks created in older renders (the reconcile interval)
  const viewRef = useRef(view)
  viewRef.current = view
  // Alarms are armed ahead of time, so each text names the phase that is ending
  const alarmBody = (e: { phase: 'focus' | 'break'; round: number }) =>
    e.phase === 'focus'
      ? e.round === LONG_EVERY ? 'Four rounds done! Time for a longer break.' : 'Round done! Time for a break.'
      : e.round === LONG_EVERY ? "Set complete! Start another whenever you're ready." : "Break's over. Next round is starting."
  /** One native alarm per phase end left in the set. Only user actions re-arm; natural transitions are already armed. */
  const armSession = (s: Session) =>
    scheduleSessionAlarms(phaseEnds(s, Date.now()).map((e) => ({ at: e.at, title: PALS[palRef.current].name, body: alarmBody(e) })))
  /** Explicit opt-in (reminders card or Study hint): the only path allowed to show OS permission screens. */
  const turnOnAlarms = () =>
    enableAlarms().then((granted) => {
      setSettings((s) => ({ ...s, notify: granted }))
      if (!granted) return
      syncEventAlarms(ev.current, name)
      const s = sessionRef.current
      if (s.phase !== 'idle' && !isPaused(s)) armSession(s)
    })

  /** The one place a session changes: logs focus and lets the pal react to a new phase (or a finished set). */
  function applySession(next: Session, prev: Session, natural = false) {
    // Update the ref now, not on next render: a second check() before re-render must not re-apply the same transition
    sessionRef.current = next
    logFocus(next.completedFocusMs - prev.completedFocusMs)
    const changed = next.phase !== prev.phase || next.round !== prev.round
    // Moving to idle on its own means the set finished; the user's Stop goes through studyStop instead
    if (changed && (next.phase !== 'idle' || natural)) {
      const key = next.phase === 'idle' ? 'setDone' : next.phase === 'focus' ? 'focusStart' : phaseLabel(next) === 'Long break' ? 'longBreak' : 'breakStart'
      const line = say(palRef.current, key)
      if (natural) {
        if (document.hidden) notifyWeb(PALS[palRef.current].name, line)
        if (!isQuiet(Date.now())) playChime()
        // The Study screen shows the line itself; on other tabs a toast is the visual cue, which stays in quiet hours
        if (viewRef.current !== 'study') toast({ text: line })
      }
      setStudyLine(line)
      if (prev.phase === 'focus' && next.phase === 'break') feel('cheer', 1500)
    }
    setSession(next)
  }
  // Start/Resume/Skip are taps, so they also unlock audio for the chime that plays later from a timer
  const studyStart = () => {
    unlockChime()
    const s = start(Date.now())
    applySession(s, sessionRef.current)
    armSession(s)
  }
  const studyPause = () => {
    cancelSessionAlarms()
    applySession(pause(sessionRef.current, Date.now()), sessionRef.current)
  }
  const studyResume = () => {
    unlockChime()
    const r = resume(sessionRef.current, Date.now())
    applySession(r, sessionRef.current)
    armSession(r)
  }
  const studySkip = () => {
    unlockChime()
    const s = skip(sessionRef.current, Date.now())
    applySession(s, sessionRef.current)
    armSession(s)
  }
  const studyStop = () => {
    const s = sessionRef.current
    const partial = Math.round(focusElapsed(s, Date.now()) / 60_000)
    logFocus(focusElapsed(s, Date.now()))
    cancelSessionAlarms()
    setStudyLine(say(palRef.current, 'sessionDone', { m: todayFocus + Math.max(0, partial) }))
    setSession(stop())
  }
  // Catch up from timestamps every second while running, and right away when the tab becomes visible again
  const sessionRunning = session.phase !== 'idle' && !isPaused(session)
  useEffect(() => {
    if (!sessionRunning) return
    const check = () => {
      const prev = sessionRef.current
      const next = tick(prev, Date.now())
      if (next !== prev) applySession(next, prev, true)
    }
    check()
    const i = setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', check) }
  }, [sessionRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setInstant(true)
        setCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const toggleCollapse = () => {
    setInstant(false)
    setCollapsed((c) => !c)
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).has('selftest')) import('./lib/parse.test-cases').then((m) => { m.selftest() })
  }, [])

  /* ---------- persistence & clocks ---------- */
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ settings, events, tasks, msgs: msgs.slice(-80), asked, alerted, log, offset, session, focusLog } satisfies Saved))
  }, [settings, events, tasks, msgs, asked, alerted, log, offset, session, focusLog])
  useEffect(() => {
    const i = setInterval(() => setClock(Date.now()), 20_000)
    const mq = window.matchMedia('(max-width: 899px)')
    const onMq = () => setMobile(mq.matches)
    mq.addEventListener('change', onMq)
    let last = Date.now()
    const poke = () => { last = Date.now(); setIdleLong(false) }
    const idle = setInterval(() => Date.now() - last > 120_000 && setIdleLong(true), 10_000)
    window.addEventListener('pointerdown', poke)
    window.addEventListener('keydown', poke)
    return () => { clearInterval(i); clearInterval(idle); mq.removeEventListener('change', onMq); window.removeEventListener('pointerdown', poke); window.removeEventListener('keydown', poke) }
  }, [])
  useEffect(() => {
    if (!mood) return
    const t = setTimeout(() => setMood(null), Math.max(0, mood.until - Date.now()))
    return () => clearTimeout(t)
  }, [mood])

  const palState: PalState = micOn || typing ? 'listening' : mood ? mood.state : isQuiet(now) || idleLong ? 'sleeping' : 'idle'
  const feel = (state: PalState, ms = 1600) => setMood({ state, until: Date.now() + ms })

  /* ---------- voice ---------- */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  useEffect(() => {
    // warm the offline voice early so replies don't fall back to the browser voice
    const t = setTimeout(loadKokoro, settings.voiceOn ? 0 : 3000)
    return () => clearTimeout(t)
  }, [settings.voiceOn])
  const voiceOnRef = useRef(settings.voiceOn)
  /* ---------- voice & speech ---------- */
  const cleanForSpeech = (raw: string): string => {
    return raw
      .replace(/[*#_~`>]/g, '') // remove markdown symbols
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // remove markdown links, keep text
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // remove emojis
      .replace(/\b'yan\b/gi, 'yan') // normalize Tagalog contractions
      .replace(/\b'to\b/gi, 'to')
      .replace(/\b'di\b/gi, 'hindi')
      .replace(/\b'ko\b/gi, 'ko')
      .replace(/\b'yung\b/gi, 'yung')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const speak = useCallback((text: string, force = false) => {
    if ((!voiceOnRef.current && !force) || !text) return
    if (!('speechSynthesis' in window)) return

    const clean = cleanForSpeech(text)
    if (!clean) return

    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    const all = voices.length ? voices : window.speechSynthesis.getVoices()

    if (pal === 'jhyvie') {
      // Jhyvie speaks Taglish: search for Philippine English (en-PH) or Filipino (fil-PH / tl-PH)
      const ph = all.find((v) => v.lang === 'en-PH' || v.lang === 'fil-PH' || v.lang === 'tl-PH' || /philippines|filipino|tagalog/i.test(v.name))
      if (ph) {
        u.voice = ph
        u.lang = ph.lang
      } else {
        const FEMALE = /female|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|libby|sonia|natasha|hazel|susan|serena|ava|allison|emma|michelle|google us english/i
        const f = all.find((v) => FEMALE.test(v.name)) ?? all[0]
        if (f) u.voice = f
        u.lang = f?.lang ?? 'en-US'
      }
      u.pitch = 1.2
      u.rate = 1.04
    } else if (pal === 'rei') {
      const FEMALE = /female|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|libby|sonia|natasha|hazel|susan|serena|ava|allison|emma|michelle|google us english/i
      const f = all.find((v) => FEMALE.test(v.name)) ?? all[0]
      if (f) u.voice = f
      u.lang = f?.lang ?? 'en-US'
      u.pitch = 1.05
      u.rate = 0.96
    } else if (pal === 'diel') {
      const MALE = /\bmale|daniel|alex\b|fred|david|guy|ryan|mark|george|thomas|aaron|arthur|oliver|christopher|eric|google uk english male/i
      const m = all.find((v) => MALE.test(v.name) && !/female/i.test(v.name)) ?? all[0]
      if (m) u.voice = m
      u.lang = m?.lang ?? 'en-US'
      u.pitch = 0.95
      u.rate = 1.0
    } else {
      const MALE = /\bmale|daniel|alex\b|fred|david|guy|ryan|mark|george|thomas|aaron|arthur|oliver|christopher|eric|google uk english male/i
      const m = all.find((v) => MALE.test(v.name) && !/female/i.test(v.name)) ?? all[0]
      if (m) u.voice = m
      u.lang = m?.lang ?? 'en-US'
      u.pitch = 1.05
      u.rate = 1.12
    }

    let keep = 0
    u.onstart = () => {
      feel('talking', 60_000)
      keep = window.setInterval(() => window.speechSynthesis.speaking && window.speechSynthesis.resume(), 8_000)
    }
    const stop = () => {
      clearInterval(keep)
      setMood((m) => (m?.state === 'talking' ? null : m))
    }
    u.onend = stop
    u.onerror = stop

    setTimeout(() => {
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
    }, 25)
  }, [pal, voices])

  const recRef = useRef<any>(null)
  const SR = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null

  /* ---------- messaging helpers ---------- */
  const toast = (t: Omit<Toast, 'id'>) => setToasts((x) => [...x.slice(-2), { id: uid(), ...t }])
  const dismiss = useCallback((id: string) => setToasts((x) => x.filter((t) => t.id !== id)), [])
  const palSay = (text: string, extra: Partial<Msg> = {}, state: PalState = 'talking') => {
    setBubble({ id: uid(), mascotId: palRef.current, text, kind: 'response' })
    // Always record pal replies in the chat history feed, avoiding immediate duplicates
    setMsgs((m) => {
      const last = m[m.length - 1]
      if (last && last.from === 'pal' && last.text === text && !extra.card) {
        return m
      }
      return [...m, { id: uid(), from: 'pal', text, ...extra }]
    })
    feel(state, state === 'talking' ? Math.min(2600, 500 + text.length * 28) : 1800)
    speak(text)
    // A card needs a tap, and on phones the collapsed drawer hides cards: open it so the button is in reach
    if (mobile && (extra.card?.type === 'event' || extra.card?.type === 'readback')) setChatOpen(true)
  }

  // Daily brief on the first open of the day, built only from app-computed facts
  useEffect(() => {
    if (!settings.onboarded || isQuiet(Date.now())) return
    const today = new Date().toDateString()
    if (settings.lastBrief === today) return
    const id = setTimeout(async () => {
      const w = (await Promise.race([refreshWeather(), new Promise<null>((r) => setTimeout(() => r(null), 4000))])) ?? getCachedWeather()
      if (w) setWeather(w)
      const s = buildContext(Date.now(), ev.current, tk.current, w, settings.prefs)
      const h = new Date().getHours()
      palSay([
        h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!',
        s.today === 'nothing else' ? 'Nothing else planned today.' : `Still today: ${s.today}.`,
        s.weather ? `Weather: ${s.weather}.` : '',
        s.insight,
      ].filter(Boolean).join(' '))
      setSettings((x) => ({ ...x, lastBrief: today }))
    }, 1500)
    return () => clearTimeout(id)
  }, [settings.onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = (id: string, resolved: string, patch: Partial<Msg> = {}) => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, resolved, ...patch } : x)))
  const flash = (ids: string[]) => {
    setHighlight(new Set(ids))
    setTimeout(() => setHighlight(new Set()), 2600)
  }
  const showWeekOf = (t: number) => {
    setWeekOff(Math.round((startOfWeek(t) - startOfWeek(nowRef.current)) / (7 * DAY)))
    setDayIdx((new Date(t).getDay() + 6) % 7)
  }

  /* ---------- planning ---------- */
  function offer(task: Task, hours: number, base: CalEvent[], lead: string) {
    const p = propose(task, hours, base, nowRef.current, settings.energy, settings.prefs)
    const next = [...base, ...p.blocks]
    setEvents(next)
    const commute = task.kind === 'exam' && base.some((e) => e.kind === 'commute' && e.start > nowRef.current && e.start < task.due && !e.note)
    const card: Card = { type: 'proposal', taskId: task.id, blockIds: p.blocks.map((b) => b.id), why: p.why, shortfall: p.shortfall, freeHours: p.freeHours, commute }
    palSay(lead, { card }, p.shortfall > 0 ? 'alarmed' : 'talking')
    if (p.blocks[0]) {
      showWeekOf(p.blocks[0].start)
      flash(p.blocks.map((b) => b.id))
    }
  }

  function createTask(d: Draft, lead = say(pal, 'proposal')) {
    if (!d.due || !d.hours) return
    const hasTime = new Date(d.due).getHours() !== 23
    const task: Task = { id: uid(), title: d.title, kind: d.kind, due: d.due, hours: d.hours, doneHours: 0 }
    const marker: CalEvent =
      d.kind === 'exam' && hasTime
        ? { id: uid(), title: d.title, kind: 'exam', start: d.due, end: d.due + 1.5 * HOUR, status: 'planned', taskId: task.id }
        : { id: uid(), title: d.title, kind: 'deadline', start: d.due, end: d.due, status: 'planned', taskId: task.id }
    setTasks((t) => [...t, task])
    offer(task, d.hours, [...ev.current, marker], lead)
  }

  function reflow(taskId: string, base: CalEvent[], doneDelta = 0) {
    const task = tk.current.find((t) => t.id === taskId)
    if (!task) return setEvents(base)
    const doneHours = task.doneHours + doneDelta
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, doneHours } : t)))
    // drop stale suggestions for this task, keep accepted future blocks
    const kept = base.filter((e) => !(e.taskId === taskId && e.status === 'proposed'))
    const future = kept.filter((e) => e.taskId === taskId && e.kind === 'work' && e.status === 'planned' && e.start >= nowRef.current).reduce((a, e) => a + hoursOf(e), 0)
    const left = Math.max(0, task.hours - doneHours - future)
    if (left < 0.25) {
      setEvents(kept)
      return palSay(say(pal, 'reflowNone'))
    }
    offer({ ...task, doneHours }, left, kept, say(pal, 'reflow', { h: fmtHours(left) }))
  }

  /* ---------- chat input ---------- */
  function planTask(t: Task) {
    setCollapsed(false)
    if (mobile) setChatOpen(true)
    reflow(t.id, ev.current)
  }

  /** Show one event as a confirm card (Add it / Never mind). Older unanswered event cards are marked replaced. */
  function previewEvent(text: string, e: { title: string; kind: string; start: number; end: number; days?: number[] }) {
    const slots = e.days?.length ? occurrences(e.start, e.end, e.days, nowRef.current) : [{ start: e.start, end: e.end }]
    const conflicts = ev.current.filter((x) => x.kind === 'work' && (x.status === 'planned' || x.status === 'proposed') && slots.some((s) => x.start < s.end && x.end > s.start)).length
    const first = slots[0] ?? { start: e.start, end: e.end }
    setMsgs((ms) => ms.map((m) => (m.card?.type === 'event' && !m.resolved ? { ...m, resolved: 'Changed' } : m)))
    palSay(text, { card: { type: 'event', title: e.title, kind: e.kind, start: first.start, end: first.end, conflicts, whatIf: true, days: e.days } }, conflicts ? 'alarmed' : 'talking')
    showWeekOf(first.start)
  }

  const sendRef = useRef(send)
  sendRef.current = send
  async function send(text: string) {
    // Recent chat + the card still waiting for an answer, so follow-ups ("no, it's lunch") have context
    const openMsg = [...msgs].reverse().find((m) => m.from === 'pal' && m.card?.type === 'event' && !m.resolved)
    const openCard = openMsg?.card
    const lastEvent = openCard?.type === 'event' ? { title: openCard.title, kind: openCard.kind, start: openCard.start, end: openCard.end, days: openCard.days } : null
    // Plain lines only: the waiting card goes in the facts, since labels here get copied into replies
    const history = msgs.slice(-8).filter((m) => m.text).map((m) => ({
      role: m.from === 'me' ? ('user' as const) : ('assistant' as const),
      content: m.text,
    }))

    setMsgs((m) => [...m, { id: uid(), from: 'me', text }])
    const snap = buildContext(nowRef.current, ev.current, tk.current, weather, settings.prefs, lastEvent)
    const t = turn(text, { pal, now: nowRef.current, draft, awaiting, pending, lastEvent, facts: { next: snap.next } })
    setDraft(t.draft)
    setAwaiting(t.awaiting)
    if (t.pending !== undefined) setPending(t.pending)
    feel('listening', 500)

    const groqKey = getGroqApiKey()
    let groqText: string | null = null
    let groqAction: AiAction | undefined
    let usedModel: string | undefined

    // Layer 1 Guardrail: If local safety rules detected cheating, grade prediction,
    // psychiatric diagnosis, or prompt injection, bypass AI entirely and use the safe refusal.
    // Off-topic is NOT a safety block: let the AI write its own warm redirect.
    const isSafetyFilterTriggered = Boolean(t.rule && !/off-topic/.test(t.rule))

    // Call AI (Groq or local Ollama) if configured, input is safe, and we're not inside a tight draft confirmation prompt
    if (!isSafetyFilterTriggered && (!draft || !awaiting)) {
      setTyping(true)
      const t0 = performance.now()
      try {
        const ai = await askGroq(text, pal, groqKey, nowRef.current, history, snap, !!openMsg)
        if (ai?.text) {
          // A reply claiming it already added something it can't add: point at the real way instead
          groqText = ai.claimed ? (openMsg || ai.action?.type === 'addEvent' ? say(pal, 'confirmHint') : null) : ai.text
          groqAction = ai.action
          usedModel = ai.modelUsed
          setLastLatency(Math.round(performance.now() - t0))
        }
      } catch {}
      setTyping(false)
    }

    if (usedModel) {
      setActiveModel(usedModel)
    } else {
      setActiveModel('Local Rules')
    }
    setLastIntent(groqAction && groqAction.type !== 'none' && t.action?.type !== 'reviseEvent' && t.action?.type !== 'pref' ? groqAction.type : t.action?.type ?? (t.rule ? 'scope filter' : 'chat'))

    setTimeout(() => {
      const a = t.action
      // 0. A correction to the waiting card is deterministic; it wins over whatever the AI guessed
      if (a?.type === 'reviseEvent') return previewEvent(t.text, a)
      if (a?.type === 'pref') {
        setSettings((s) => ({ ...s, prefs: a.clear ? {} : { ...s.prefs, ...(a.latestHour != null ? { latestHour: a.latestHour } : {}), ...(a.blockedDays ? { blockedDays: [...new Set([...(s.prefs?.blockedDays ?? []), ...a.blockedDays])] } : {}) } }))
        return palSay(t.text, {}, 'happy')
      }

      // The user answered the waiting card in their own words: the model read the intent, the card supplies the details
      if (openMsg && (groqAction?.type === 'confirmEvent' || groqAction?.type === 'skipEvent')) {
        onCard(openMsg.id, groqAction.type === 'confirmEvent' ? 'addEvent' : 'skipEvent')
        return palSay(groqText || say(pal, groqAction.type === 'confirmEvent' ? 'eventAdded' : 'eventSkipped', { what: openCard?.type === 'event' ? `${openCard.title}, ${fmtDay(openCard.start)} ${fmtTime(openCard.start)}` : 'It' }), {}, 'happy')
      }

      // 1. AI-proposed event or task: always shown for confirmation first
      if (groqAction && groqAction.type === 'addEvent') {
        const startMs = parseIsoToLocalMs(groqAction.start) || nowRef.current
        const endMs = parseIsoToLocalMs(groqAction.end) || (startMs + 1 * HOUR)
        return previewEvent(groqText || say(pal, 'eventAdd'), {
          title: groqAction.title?.trim() || 'Event',
          kind: groqAction.kind || 'work',
          start: startMs,
          end: Math.max(endMs, startMs + 30 * MIN),
          days: groqAction.days,
        })
      }

      if (groqAction && groqAction.type === 'createTask') {
        const dueMs = parseIsoToLocalMs(groqAction.due) || (nowRef.current + 2 * DAY)
        const title = groqAction.title?.trim() || 'Task'
        const kind = groqAction.kind === 'exam' ? 'exam' : 'assignment'
        const d: Draft = { title, kind, due: dueMs, hours: groqAction.hours || defaultHours(kind) }
        setDraft(d)
        setAwaiting('confirm')
        return palSay(groqText || say(pal, 'readback'), { card: { type: 'readback', draft: d } }, 'talking')
      }

      // The model picks the intent; the app does the math (slots, free time) so nothing is hallucinated
      if (groqAction?.type === 'findTime') {
        const due = parseIsoToLocalMs(groqAction.due) || (nowRef.current + 7 * DAY)
        const title = groqAction.title?.trim() || 'Study'
        return createTask({ title, kind: 'assignment', due, hours: groqAction.hours || 2 }, groqText || say(pal, 'proposal'))
      }
      if (groqAction?.type === 'analyzeWeek') return palSay(groqText || `${summary()} ${snap.insight}`)
      // A "redirect" is only trusted when the rules engine also saw nothing to plan (e.g. "math exam tuesday" is in scope)
      if (groqAction?.type === 'redirect' && groqText && !a && !t.draft) return palSay(groqText, { rule: 'Scope: redirected to planning' })
      if (groqAction?.type === 'redirect') groqText = null

      // 2. Local rule action if present
      const replyText = groqText || t.text
      if (!a) return palSay(replyText, { card: t.card, chips: groqText ? undefined : t.chips, rule: t.rule })
      // Offline net: only when no model answered, so a model that heard "not yet" isn't overruled
      if (a.type === 'confirmEvent' || a.type === 'skipEvent') {
        if (groqText || !openMsg) return palSay(replyText)
        onCard(openMsg.id, a.type === 'confirmEvent' ? 'addEvent' : 'skipEvent')
        return palSay(t.text, {}, 'happy')
      }
      if (a.type === 'confirmDraft') return createTask(a.draft)
      if (a.type === 'openSyllabus') {
        palSay(replyText)
        return setSyllabus(true)
      }
      if (a.type === 'energy') {
        setSettings((s) => ({ ...s, energy: a.value }))
        return palSay(replyText)
      }
      if (a.type === 'summary') return palSay(groqText || `${summary()} ${snap.insight}`)
      if (a.type === 'weather') {
        setTyping(true)
        return void refreshWeather().then((w) => {
          setTyping(false)
          if (w) setWeather(w)
          palSay(w ? weatherReply(w) : say(pal, 'weatherNone'))
        })
      }
      if (a.type === 'freeTime') return palSay(freeTimeReply(a.day))
      if (a.type === 'addEvent') previewEvent(replyText || say(pal, a.whatIf ? 'whatIf' : 'eventAdd'), a)
    }, groqText ? 0 : 380 + Math.random() * 380)
  }

  function weatherReply(w: Weather) {
    const base = `Right now it's ${weatherLine(w)}.`
    if (!w.rainHours.length) return base
    const r0 = w.rainHours[0], r1 = w.rainHours[w.rainHours.length - 1] + HOUR
    const wet = ev.current.find((e) => e.status === 'planned' && e.kind !== 'deadline' && e.start < r1 && e.end > r0)
    return wet ? `${base} Heads up, that overlaps your ${wet.title} at ${fmtTime(wet.start)}, so bring an umbrella!` : base
  }

  function freeTimeReply(day: number) {
    const d = startOfDay(day)
    const busy = ev.current.filter((e) => e.status !== 'done' && e.status !== 'missed')
    const gaps = freeGaps(d, Math.max(nowRef.current, d), d + DAY, busy, settings.prefs)
    const when = d === startOfDay(nowRef.current) ? 'today' : fmtDay(d).replace(/,.*/, '')
    if (!gaps.length) return `${when[0].toUpperCase()}${when.slice(1)} is packed, no free 45-minute windows left.`
    const total = gaps.reduce((a, g) => a + (g.e - g.s), 0) / HOUR
    return `Free ${when}: ${gaps.map((g) => `${fmtTime(g.s)}–${fmtTime(g.e)}`).join(', ')} (${fmtHours(total)} total).`
  }

  function summary() {
    const n = nowRef.current
    const today = ev.current.filter((e) => e.start >= n && startOfDay(e.start) === startOfDay(n) && e.kind !== 'commute' && e.kind !== 'deadline' && e.status !== 'proposed').sort((a, b) => a.start - b.start)
    const ws = startOfWeek(n)
    const week = ev.current.filter((e) => e.kind === 'work' && e.start >= ws && e.start < addDays(ws, 7))
    const planned = week.filter((e) => e.status === 'planned').reduce((a, e) => a + hoursOf(e), 0)
    const done = week.filter((e) => e.status === 'done').reduce((a, e) => a + hoursOf(e), 0)
    const nextDue = tk.current.filter((t) => t.due > n).sort((a, b) => a.due - b.due)[0]
    const parts = [
      today.length ? `Still today: ${today.slice(0, 3).map((e) => `${e.title} at ${fmtTime(e.start)}`).join(', ')}.` : 'Nothing else on today.',
      `This week: ${fmtHours(planned)} of planned work left, ${fmtHours(done)} done.`,
      nextDue ? `Next deadline: ${nextDue.title}, ${fmtDay(nextDue.due)}.` : 'No deadlines coming up.',
    ]
    return parts.join(' ')
  }

  /* ---------- card actions ---------- */
  function onCard(id: string, action: string, arg?: string) {
    const m = msgs.find((x) => x.id === id)
    const c = m?.card
    if (action === 'chip') return setMsgs((ms) => ms.map((x) => (x.id === id ? { ...x, chips: undefined } : x)))
    if (c?.type === 'readback') {
      if (action === 'confirm') {
        resolve(id, 'Confirmed')
        setDraft(null)
        setAwaiting(null)
        return createTask(c.draft)
      }
      resolve(id, 'Changing…')
      return palSay(say(pal, 'fix'))
    }
    if (c?.type === 'proposal') {
      if (action === 'accept') {
        const ids = new Set(c.blockIds)
        const before = ev.current
        setEvents(before.map((e) => (ids.has(e.id) && e.status === 'proposed' ? { ...e, status: 'planned' } : e)))
        resolve(id, 'Added to your calendar')
        palSay(say(pal, 'accepted'))
        setTimeout(() => feel('happy', 1600), 60)
        toast({ text: `${c.blockIds.length} block${c.blockIds.length > 1 ? 's' : ''} added`, action: { label: 'Undo', fn: () => { setEvents(before); resolve(id, '') } } })
        if (!settings.notifyAsked) {
          setSettings((s) => ({ ...s, notifyAsked: true }))
          setTimeout(() => palSay(say(pal, 'notify'), { card: { type: 'notify' } }), 1400)
        }
      } else if (action === 'decline') {
        const ids = new Set(c.blockIds)
        setEvents(ev.current.filter((e) => !(ids.has(e.id) && e.status === 'proposed')))
        resolve(id, 'Kept your calendar as is')
        palSay(say(pal, 'notNow'))
      } else if (action === 'commute') {
        const task = tk.current.find((t) => t.id === c.taskId)
        if (!task) return
        let n = 0
        setEvents(ev.current.map((e) => (e.kind === 'commute' && !e.note && e.start > nowRef.current && e.start < task.due ? (n++, { ...e, note: `Flashcards · ${task.title}` }) : e)))
        setMsgs((ms) => ms.map((x) => (x.id === id ? { ...x, card: { ...c, commute: false } } : x)))
        setTimeout(() => toast({ text: `Light review added to ${n} bus ride${n === 1 ? '' : 's'}` }), 0)
      }
      return
    }
    if (c?.type === 'checkin' && arg) return answerCheckin(arg, action as 'done' | 'partly' | 'notyet')
    if (c?.type === 'event') {
      if (action === 'skipEvent') return resolve(id, 'Not added')
      const slots = c.days?.length ? occurrences(c.start, c.end, c.days, nowRef.current) : [{ start: c.start, end: c.end }]
      const added: CalEvent[] = slots.map((s) => ({ id: uid(), title: c.title, kind: c.kind as CalEvent['kind'], start: s.start, end: s.end, status: 'planned' }))
      const hit = ev.current.filter((e) => e.kind === 'work' && (e.status === 'planned' || e.status === 'proposed') && added.some((a) => e.start < a.end && e.end > a.start))
      const base = [...ev.current.filter((e) => !hit.includes(e)), ...added]
      showWeekOf(added[0].start)
      setView('week')
      if (mobile) setChatOpen(false)
      resolve(id, c.conflicts ? 'Added. Re-planning the overlap…' : added.length > 1 ? `Added ${added.length} sessions over the next 8 weeks` : 'Added')
      setTimeout(() => feel('happy', 1400), 60)
      const affected = [...new Set(hit.map((e) => e.taskId).filter(Boolean))] as string[]
      if (affected.length) reflow(affected[0], base)
      else {
        setEvents(base)
        flash(added.map((a) => a.id))
      }
      return
    }
    if (c?.type === 'notify') {
      if (action === 'notifyOn') {
        turnOnAlarms()
        resolve(id, 'Reminders on')
      } else resolve(id, 'In-app reminders only')
    }
  }

  // Keep offline hardware alarms synchronized with planned events
  useEffect(() => {
    if (settings.notify) {
      syncEventAlarms(events, name)
    }
  }, [events, settings.notify, name])

  function answerCheckin(eventId: string, a: 'done' | 'partly' | 'notyet') {
    const e = ev.current.find((x) => x.id === eventId)
    if (!e) return
    const h = hoursOf(e)
    if (a === 'done') {
      setEvents(ev.current.map((x) => (x.id === eventId ? { ...x, status: 'done' } : x)))
      if (e.taskId) setTasks((ts) => ts.map((t) => (t.id === e.taskId ? { ...t, doneHours: t.doneHours + h } : t)))
      palSay(say(pal, 'doneOk'))
      setTimeout(() => feel('cheer', 1500), 60)
      return
    }
    const base = ev.current.map((x) => (x.id === eventId ? { ...x, status: 'missed' as const } : x))
    if (e.taskId) reflow(e.taskId, base, a === 'partly' ? h / 2 : 0)
    else setEvents(base)
  }

  /* ---------- reminder engine (runs on every clock / sim tick) ---------- */
  useEffect(() => {
    if (!settings.onboarded || isQuiet(now)) return
    const soon = events.filter((e) => e.status === 'planned' && e.kind !== 'deadline' && e.kind !== 'commute' && e.start > now && e.start <= now + 10 * MIN && !alerted.includes(e.id))
    if (soon.length) {
      setAlerted((a) => [...a, ...soon.map((e) => e.id)])
      const e = soon[0]
      const mins = Math.max(1, Math.round((e.start - now) / MIN))
      const text = `${e.title} starts in ${mins} min`
      toast({ text, pal })
      feel('alert', 2400)
      if (settings.notify && 'Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(`${name}: ${text}`, { tag: e.id })
    }
    const ended = events.filter((e) => e.kind === 'work' && e.status === 'planned' && e.end <= now && !asked.includes(e.id))
    const dayKey = String(startOfDay(now))
    if (ended.length && (log[dayKey] ?? 0) < MAX_CHECKINS) {
      setAsked((a) => [...a, ...ended.map((e) => e.id)])
      setLog((l) => ({ ...l, [dayKey]: (l[dayKey] ?? 0) + 1 }))
      palSay(say(pal, ended.length > 1 ? 'checkinMany' : 'checkin'), { card: { type: 'checkin', eventIds: ended.map((e) => e.id) } }, 'alert')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, settings.onboarded])

  /* ---------- voice input ---------- */
  const MIC_ERR: Record<string, string> = {
    'not-allowed': 'Mic is blocked here. The preview runs in a frame without mic access, so open the app in a new tab and allow the microphone.',
    'service-not-allowed': 'Mic is blocked here. Open the app in a new tab and allow the microphone.',
    'audio-capture': "I can't find a microphone. Check that one is plugged in and not used by another app.",
    'no-speech': "I didn't hear anything. Tap the mic and try again.",
    network: "Your browser's speech service needs a connection right now. You can type instead.",
  }
  function micFail(code: string) {
    setMicOn(false)
    setInterim('')
    if (code === 'aborted') return
    const text = MIC_ERR[code] ?? `The mic stopped (${code}). You can type instead.`
    feel('alarmed', 1800)
    const blocked = code === 'not-allowed' || code === 'service-not-allowed'
    toast({ text: blocked ? 'Microphone blocked' : 'Mic problem', action: blocked && window.self !== window.top ? { label: 'Open in new tab', fn: () => window.open(location.href, '_blank') } : undefined })
    setBubble({ id: uid(), mascotId: palRef.current, text, kind: 'response' })
  }

  const micStarting = useRef(false)
  const micStopEarly = useRef(false)
  async function toggleMic() {
    if (!SR) return micFail('unsupported')
    if (micStarting.current) {
      micStopEarly.current = true // released before the mic was ready
      return
    }
    if (micOn) {
      recRef.current?.stop()
      return
    }
    micStarting.current = true
    micStopEarly.current = false
    // Ask for the mic up front: clear prompt, and we learn early if the frame blocks it
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true })
      stream?.getTracks().forEach((t) => t.stop())
    } catch (err: any) {
      micStarting.current = false
      return micFail(err?.name === 'NotFoundError' ? 'audio-capture' : 'not-allowed')
    }
    if (!settings.voiceOn) setSettings((s) => ({ ...s, voiceOn: true })) // talking to it → it talks back
    window.speechSynthesis?.cancel()
    stopKokoro()
    const r = new SR()
    r.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US'
    r.interimResults = true
    r.continuous = false
    let final = ''
    r.onresult = (e: any) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += res[0].transcript
        else live += res[0].transcript
      }
      setInterim((final + live).trim())
    }
    r.onend = () => {
      setMicOn(false)
      setInterim('')
      if (final.trim()) sendRef.current(final.trim())
    }
    r.onerror = (e: any) => micFail(e.error)
    recRef.current = r
    try {
      r.start()
      setMicOn(true)
      if (micStopEarly.current) r.stop()
    } catch {
      micFail('aborted')
    }
    micStarting.current = false
  }

  /* ---------- calendar actions ---------- */
  function deleteEvent(e: CalEvent) {
    const before = ev.current
    setEvents(before.filter((x) => x.id !== e.id))
    setPop(null)
    feel('shocked', 1100)
    toast({ text: `Deleted “${e.title}”`, action: { label: 'Undo', fn: () => setEvents(before) } })
  }

  function addSyllabus(items: SyllabusItem[]) {
    setSyllabus(false)
    const newTasks = items.map((i) => ({ id: uid(), title: i.title, kind: i.kind, due: i.due, hours: i.hours, doneHours: 0 }))
    setTasks((t) => [...t, ...newTasks])
    setEvents((e) => [...e, ...newTasks.map((t) => ({ id: uid(), title: t.title, kind: 'deadline' as const, start: t.due, end: t.due, status: 'planned' as const, taskId: t.id }))])
    const first = newTasks[0]
    palSay(
      `Added ${items.length} deadline${items.length > 1 ? 's' : ''}. ${first ? `Closest is ${first.title} on ${fmtDay(first.due)}. Want a timeline for it?` : ''}`,
      { chips: first ? [`Plan ${first.title}`] : undefined },
    )
    if (first) {
      setDraft({ title: first.title, kind: first.kind, due: first.due })
      setAwaiting('hours')
    }
  }

  function finishOnboarding(v: { pal: PalId; name: string; energy: Energy; advancedMode?: boolean }) {
    const first = !settings.onboarded
    setSettings((s) => ({ ...s, ...v, onboarded: true, advancedMode: v.advancedMode ?? s.advancedMode ?? false }))
    setEditing(false)
    if (first)
      setTimeout(() => {
        setMsgs([])
        setBubble({ id: uid(), mascotId: v.pal, text: say(v.pal, 'greet'), kind: 'greeting' })
        feel('wave', 1600)
      }, 250)
  }

  function clearAllPlans() {
    const beforeEv = ev.current, beforeTk = tk.current
    setEvents([])
    setTasks([])
    setClearing(false)
    feel('shocked', 1100)
    toast({ text: 'All plans deleted', action: { label: 'Undo', fn: () => { setEvents(beforeEv); setTasks(beforeTk) } } })
  }

  function resetDemo() {
    const s = seedWeek(Date.now())
    setEvents(s.events)
    setTasks(s.tasks)
    setAsked([])
    setAlerted([])
    setLog({})
    setOffset(0)
    setWeekOff(0)
    setMsgs([])
    setBubble({ id: uid(), mascotId: pal, text: say(pal, 'greet'), kind: 'greeting' })
  }

  /* ---------- derived view ---------- */
  const weekStart = addDays(startOfWeek(now), weekOff * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const shownDays = mobile ? [days[dayIdx]] : days
  const hl = useMemo(() => new Set([...highlight, ...hover]), [highlight, hover])
  const weekLabel = `${new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(addDays(weekStart, 6)).toLocaleDateString('en-US', { month: weekOff === 0 && new Date(weekStart).getMonth() === new Date(addDays(weekStart, 6)).getMonth() ? undefined : 'short', day: 'numeric' })}`

  const chat = (
    <Chat
      msgs={msgs} bubble={bubble} pal={pal} palName={name} palState={palState} events={events}
      onSend={send} onCard={onCard} onHover={setHover} onTyping={setTyping}
      voiceOn={settings.voiceOn}
      setVoiceOn={(v) => {
        setSettings((s) => ({ ...s, voiceOn: v }))
        if (v) speak(say(pal, 'voiceOn'), true)
        else { window.speechSynthesis?.cancel(); stopKokoro() }
      }}
      micOn={micOn} toggleMic={toggleMic} micSupported={!!SR} interim={interim} compact={mobile} noPal={(view === 'home' || view === 'study') && !chatOpen}
      onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)}
      open={chatOpen} setOpen={setChatOpen} onCollapse={mobile ? undefined : toggleCollapse}
    />
  )

  const simCluster = (
    <div className="flex items-center gap-0.5 rounded-full bg-ink/[0.04] p-1 text-[12px]">
      <span className="flex items-center gap-1.5 px-2 text-ink-2" title="Simulated time for the demo">
        <Clock className="size-3.5" />
        <span className="tnum font-medium text-ink">{new Date(now).toLocaleDateString('en-US', { weekday: 'short' })} {fmtTime(now)}</span>
      </span>
      {[['+1h', HOUR], ['+1d', DAY]].map(([l, d]) => (
        <button key={l as string} onClick={() => setOffset((o) => o + (d as number))} className="press h-6 rounded-full px-2 font-medium text-ink-2 hover:bg-paper hover:text-ink">{l}</button>
      ))}
      {offset !== 0 && <button onClick={() => setOffset(0)} className="press h-6 rounded-full px-2 text-ink-3 hover:bg-paper hover:text-ink">Now</button>}
    </div>
  )

  // Any pal change (switcher or settings) greets in the bubble. Replace, never stack
  useEffect(() => {
    setBubble((b) => (b?.mascotId === pal ? b : { id: uid(), mascotId: pal, text: say(pal, 'greet'), kind: 'greeting' }))
  }, [pal])

  const switchPal = (id: PalId) => {
    if (id === pal) return
    setSettings((s) => ({ ...s, pal: id, name: PALS[id].name }))
    palRef.current = id
    setBubble({ id: uid(), mascotId: id, text: say(id, 'greet'), kind: 'greeting' })
    feel('wave', 1600)
  }
  const palSwitch = (
    <div className="flex items-center gap-0.5 rounded-full bg-paper/70 p-1 shadow-[var(--edge)] backdrop-blur-xl" role="radiogroup" aria-label="Switch pal">
      {(Object.keys(PALS) as PalId[]).map((id) => {
        const on = id === pal
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => switchPal(id)}
            title={PALS[id].name}
            className={`press flex h-10 items-center gap-1.5 rounded-full pr-1.5 pl-1 transition-[background-color,padding] duration-300 [transition-timing-function:var(--ease-out)] ${on ? 'bg-ink pr-3.5 text-paper' : 'hover:bg-ink/[0.05]'}`}
          >
            <span className="grid size-8 place-items-center overflow-hidden rounded-full" style={{ background: PALS[id].swatch }}>
              <Pal id={id} size={30} state={on ? palState : 'idle'} animate={on} />
            </span>
            {on && <span className="pop text-[13px] font-semibold">{PALS[id].name}</span>}
          </button>
        )
      })}
    </div>
  )

  const openPop = (e: CalEvent, rect: DOMRect) => setPop({ ev: e, rect })
  const openTasks = tasks.filter((t) => t.due > now && t.doneHours < t.hours).length
  const goWeek = (i: number) => {
    setWeekOff(0)
    setDayIdx(i)
    setView('week')
  }

  const weekNav = (
    <div className="flex items-center">
      <button onClick={() => setWeekOff((w) => w - 1)} className="press grid size-10 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Previous week"><ChevronL /></button>
      <span className="tnum min-w-[96px] text-center text-[14px] font-semibold">{weekLabel}</span>
      <button onClick={() => setWeekOff((w) => w + 1)} className="press grid size-10 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Next week"><ChevronR /></button>
      <button onClick={() => setClearing(true)} className="press ml-1 grid size-10 place-items-center rounded-full text-ink-3 hover-lift hover:text-red-500" aria-label="Delete all plans" title="Delete all plans"><Trash /></button>
      {weekOff !== 0 && <button onClick={() => setWeekOff(0)} className="pop press ml-1 h-8 rounded-full bg-tangerine-soft px-3 text-[12px] font-medium text-ink">This week</button>}
    </div>
  )

  const content =
    view === 'home' ? (
      <Today now={now} events={events} tasks={tasks} onOpen={openPop} onPlan={planTask} onWeek={goWeek} pal={pal} palName={name} palState={palState} onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)} onTalk={() => (mobile ? setChatOpen(true) : setCollapsed(false))} />
    ) : view === 'study' ? (
      <Study
        session={session}
        pal={pal}
        palState={mood ? mood.state : session.phase === 'break' ? 'happy' : 'idle'}
        todayMinutes={todayFocus}
        palLine={studyLine}
        alarmsOn={settings.notify}
        onStart={studyStart}
        onPause={studyPause}
        onResume={studyResume}
        onSkip={studySkip}
        onStop={studyStop}
        onEnableAlarms={turnOnAlarms}
      />
    ) : view === 'tasks' ? (
      <Tasks now={now} tasks={tasks} events={events} onPlan={planTask} onAdd={(t) => { send(t); if (mobile) setChatOpen(true) }} />
    ) : mobile ? (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 justify-between px-2 pt-2">
          {days.map((d, i) => (
            <button key={d} onClick={() => setDayIdx(i)} className={`press flex h-12 w-11 flex-col items-center justify-center rounded-[16px] transition-colors duration-200 ${i === dayIdx ? 'bg-ink text-paper' : ''}`}>
              <span className={`text-[10px] font-medium uppercase ${i === dayIdx ? 'text-paper/70' : 'text-ink-3'}`}>{new Date(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
              <span className="tnum text-[15px] font-semibold">{new Date(d).getDate()}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 py-1">{weekNav}{simCluster}</div>
        <div className="min-h-0 flex-1">
          <Calendar days={shownDays} now={now} events={events} pal={pal} highlight={hl} onOpen={openPop} quiet={QUIET} />
        </div>
      </div>
    ) : (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-4 px-4 pt-3 pb-1">
          {weekNav}
          {simCluster}
          <div className="hidden xl:block"><LoadStrip weekStart={weekStart} events={events} active={weekOff === 0 ? (new Date(now).getDay() + 6) % 7 : undefined} onPick={(i) => setDayIdx(i)} /></div>
        </div>
        <div className="min-h-0 flex-1">
          <Calendar days={shownDays} now={now} events={events} pal={pal} highlight={hl} onOpen={openPop} quiet={QUIET} />
        </div>
      </div>
    )

  return (
    <div className={`grain relative isolate flex h-dvh overflow-hidden p-3 pt-[max(52px,env(safe-area-inset-top))] pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] sm:p-4 sm:pt-[max(16px,env(safe-area-inset-top))] ${mobile ? 'flex-col gap-2' : 'gap-3 sm:gap-4'}`}>
      <div className="mist" aria-hidden />

      {mobile ? (
        <>
          <header className="flex shrink-0 items-center gap-2 px-2 pt-1">
            <Wordmark className="text-[18px]" />
            <div className="flex-1" />
            {settings.advancedMode && (
              <StatusBadge
                isOnline={isOnline}
                hasGroqKey={hasCloudAi()}
                activeModel={activeModel}
                latency={lastLatency}
                brain={brain}
                lastIntent={lastIntent}
                compact
                onOpenSettings={() => setEditing(true)}
              />
            )}
            {palSwitch}
            {themeBtn}
            <button
              onClick={() => setEditing(true)}
              className="press grid size-10 place-items-center rounded-full text-ink-2"
              aria-label="Pal and preferences"
              title="Pal and preferences"
            >
              <Gear className="size-[18px]" />
            </button>
          </header>
          <main key={view} className="under-dock view-in liquid min-h-0 flex-1 overflow-hidden rounded-[28px]">{content}</main>
          {/* Floating composer + pal above the tab bar; tap expands into the full conversation */}
          {chatOpen && <button aria-label="Close chat" onClick={() => setChatOpen(false)} className="fixed inset-0 z-30 bg-ink/10 backdrop-blur-[2px]" />}
          <div
            className="liquid-solid fixed inset-x-3 z-40 flex flex-col rounded-[30px] transition-[top] duration-[420ms] [transition-timing-function:var(--ease-drawer)]"
            style={{ top: chatOpen ? 'calc(max(44px, env(safe-area-inset-top)) + 56px)' : 'auto', bottom: chatOpen ? 'max(12px, env(safe-area-inset-bottom))' : 'calc(max(12px, env(safe-area-inset-bottom)) + 60px)' }}
          >
            {chat}
          </div>
          <div className="fixed inset-x-3 z-30" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <TabBar view={view} setView={(v) => { setView(v); setChatOpen(false) }} taskCount={openTasks} studying={session.phase !== 'idle'} />
          </div>
        </>
      ) : (
        <>
          <Rail view={view} setView={setView} onSyllabus={() => setSyllabus(true)} onSettings={() => setEditing(true)} taskCount={openTasks} dark={dark} onTheme={() => setDark((d) => !d)} studying={session.phase !== 'idle'} />
          <aside
            className={`liquid relative min-h-0 shrink-0 overflow-hidden rounded-[30px] ${instant ? '' : 'transition-[width,opacity,transform,margin] duration-[260ms] [transition-timing-function:var(--ease-out)]'} ${collapsed ? 'pointer-events-none -mr-4 w-0 -translate-x-4 opacity-0' : 'w-[clamp(400px,34vw,520px)]'}`}
            aria-hidden={collapsed}
          >
            <div className="h-full w-[clamp(400px,34vw,520px)]">{chat}</div>
          </aside>
          <section className="liquid relative min-h-0 flex-1 overflow-hidden rounded-[30px]">
            <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
              {settings.advancedMode && (
                <StatusBadge
                  isOnline={isOnline}
                  hasGroqKey={hasCloudAi()}
                  activeModel={activeModel}
                  latency={lastLatency}
                brain={brain}
                lastIntent={lastIntent}
                  onOpenSettings={() => setEditing(true)}
                />
              )}
              {palSwitch}
            </div>
            <div key={view} className="view-in h-full">{content}</div>
          </section>
          {collapsed && (
            <button
              onClick={toggleCollapse}
              className={`liquid-solid press fixed right-6 bottom-6 z-30 grid size-[72px] place-items-center rounded-full ${instant ? '' : 'pop'}`}
              aria-label={`Open chat with ${name} (⌘/)`}
              title="Open chat  ⌘/"
            >
              <Pal id={pal} state={palState} size={34} float />
              {micOn && <span className="pulse-dot absolute top-2 right-2 size-2.5 rounded-full bg-tangerine" />}
            </button>
          )}
        </>
      )}

      {pop && (
        <BlockPopover
          ev={pop.ev} rect={pop.rect} onClose={() => setPop(null)}
          onDone={() => { answerCheckin(pop.ev.id, 'done'); setPop(null) }}
          onAccept={() => { setEvents(ev.current.map((x) => (x.id === pop.ev.id ? { ...x, status: 'planned' } : x))); setPop(null) }}
          onDelete={() => deleteEvent(pop.ev)}
        />
      )}
      {clearing && <DeletePlansSheet onClose={() => setClearing(false)} onConfirm={clearAllPlans} count={events.length} />}
      {syllabus && <SyllabusSheet now={now} onClose={() => setSyllabus(false)} onAdd={addSyllabus} />}
      {(!settings.onboarded || editing) && (
        <Onboarding
          initial={settings.onboarded ? settings : undefined}
          onDone={finishOnboarding}
          onClose={settings.onboarded ? () => setEditing(false) : undefined}
          brain={brain}
          onBrain={loadBrain}
          prefsLabel={[
            settings.prefs?.latestHour != null ? `Nothing after ${fmtTime(new Date().setHours(settings.prefs.latestHour, 0, 0, 0))}` : '',
            settings.prefs?.blockedDays?.length ? `${settings.prefs.blockedDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} kept free` : '',
          ].filter(Boolean).join(' · ')}
          onClearPrefs={() => setSettings((s) => ({ ...s, prefs: {} }))}
        />
      )}
      {editing && (
        <button onClick={resetDemo} className="fixed bottom-4 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-paper px-4 py-2 text-[12.5px] text-ink-2 shadow-[var(--shadow-lg)]">Reset demo week</button>
      )}
      <Toasts items={toasts} dismiss={dismiss} />
    </div>
  )
}

