import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ANSWERABLE, defaultHours, greetLine, say, turn, type Awaiting, type Card, type Draft, type PendingEvent } from './lib/agent'
import { addDays, at, DAY, fmtDay, fmtHours, fmtTime, HOUR, hoursOf, MIN, seedWeek, startOfDay, startOfWeek, uid, type CalEvent, type PalId, type PalState, type Task } from './lib/core'
import { freeGaps, occurrences, propose, type Energy, type Prefs } from './lib/schedule'
import { buildContext, type OpenCard } from './lib/context'
import { parseRange, parseWhen } from './lib/parse'
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
import { cancelSessionAlarms, enableAlarms, notifyWeb, playChime, scheduleSessionAlarms, scheduleTimerAlarms, syncEventAlarms, unlockChime } from './lib/notifications'
import { focusElapsed, fromSaved, isPaused, LONG_EVERY, pause, phaseEnds, phaseLabel, remaining, resume, skip, start, stop, tick, type Session } from './lib/session'
import { addReminder, addTime, cancelTimer, fmtLeft, isPaused as isTimerPaused, newestTimer, NO_ALARMS, pauseTimer, resumeTimer, sayLength, startTimer, tickAlarms, timeLeft, upcomingAlarms, type Alarms, type Alert } from './lib/timers'
import { parseCommand, type Command } from './lib/commands'
import { TimerPill } from './components/TimerPill'
import { expectFollowUp, isHandsFreeOn, pauseListening, startHandsFree, stopHandsFree, type HandsFreeState } from './lib/handsfree'
import { Study } from './components/Study'
import { aiFailure, askGroq, CLOUD_CHAIN, cloudIssue, getGroqApiKey, hasCloudAi, parseIsoToLocalMs, preloadOllama, PRIMARY_MODEL, recoverEvent, toLocalIso, transcribeGroq, type AiAction, type AiFailure, type ChatTurn, type Claim } from './lib/groq'
import { StatusBadge } from './components/StatusBadge'

const KEY = 'paldo-v1'
const QUIET: [number, number] = [23, 7]
const MAX_CHECKINS = 3
const VOICE_PITCH: Record<PalId, number> = { rei: 1.1, diel: 0.9, jhyvie: 1.3, jaypee: 1.05 }

interface Settings { pal: PalId; name: string; energy: Energy; onboarded: boolean; voiceOn: boolean; notify: boolean; notifyAsked: boolean; advancedMode?: boolean; prefs?: Prefs; lastBrief?: string; userName?: string; handsFree?: boolean; sttDeviceOnly?: boolean }
interface Saved { settings: Settings; events: CalEvent[]; tasks: Task[]; msgs: Msg[]; asked: string[]; alerted: string[]; log: Record<string, number>; offset: number; session?: Session; focusLog?: Record<string, number>; alarms?: Alarms }

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

/** Chip that loads the in-browser model when Pal is offline without one */
const BRAIN_CHIP = 'Load offline brain'
/** "delete mo yan", "tanggalin mo", "cancel that" */
const REMOVE_ASK = /\b(delete|remove|tanggal\w*|bura\w*|alis\w*|cancel)\b/i
/** "asaan", "wala sa calendar", "where is it": they can't find something Pal just added */
const WHERE_ASK = /\b(asan|asaan|nasaan|nasan|where('?s| is| did) (it|that)( go)?|wala sa (calendar|kalendaryo)|di ko (makita|nakita)|hindi ko (makita|nakita)|can'?t (see|find))\b/i

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
  const [bubble, setBubble] = useState<MascotBubble | null>(() => ({ id: uid(), mascotId: init.settings.pal, text: greetLine(init.settings.pal, init.settings.userName), kind: 'greeting' }))
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
  // Your PC's AI takes ~40s to load the first time: start it now, not on the first message
  useEffect(() => preloadOllama(), [])
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
  // Width of the floating badge + pal switch (desktop), so the Week header can keep clear of it
  const clusterRef = useRef<HTMLDivElement>(null)
  const [clusterW, setClusterW] = useState(0)
  useEffect(() => {
    const el = clusterRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setClusterW(Math.ceil(el.getBoundingClientRect().width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mobile])
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
  // Voice timers and reminders ("set me a timer for 5 mins"). Timestamps, so a reload or a sleeping phone lands right.
  const [alarms, setAlarms] = useState<Alarms>(() => init.alarms ?? NO_ALARMS)
  const alarmsRef = useRef(alarms)
  alarmsRef.current = alarms
  /** The finished timer that's ringing until "stop" or a tap */
  const [ringing, setRinging] = useState<string | null>(null)
  const ringingRef = useRef(ringing)
  ringingRef.current = ringing
  /** Hands-free: Pal's line ends in a question or a card, so the next sentence answers it without "Hi {pal}" */
  const followNext = useRef(false)
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
    localStorage.setItem(KEY, JSON.stringify({ settings, events, tasks, msgs: msgs.slice(-80), asked, alerted, log, offset, session, focusLog, alarms } satisfies Saved))
  }, [settings, events, tasks, msgs, asked, alerted, log, offset, session, focusLog, alarms])
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
      // Hands-free: don't listen while Pal talks, so it never hears itself
      pauseListening(true)
      feel('talking', 60_000)
      keep = window.setInterval(() => window.speechSynthesis.speaking && window.speechSynthesis.resume(), 8_000)
    }
    const stop = () => {
      clearInterval(keep)
      setMood((m) => (m?.state === 'talking' ? null : m))
      pauseListening(false)
      // Pal asked something ("Add this?"): the answer doesn't need "Hi Jhyvie" again
      if (followNext.current) {
        followNext.current = false
        expectFollowUp()
      }
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
    // Hands-free: a question or a card means the next sentence answers it, no wake word needed.
    // It opens when Pal finishes talking (speak's end), or right away when Pal isn't talking out loud.
    if (isHandsFreeOn() && (/\?\s*$/.test(text) || (extra.card && ANSWERABLE.includes(extra.card.type)))) {
      followNext.current = true
      if (!voiceOnRef.current || !('speechSynthesis' in window)) {
        followNext.current = false
        expectFollowUp()
      }
    }
    speak(text)
    // A card needs a tap, and on phones the collapsed drawer hides cards: open it so the button is in reach
    if (mobile && (extra.card?.type === 'event' || extra.card?.type === 'readback' || extra.card?.type === 'change')) setChatOpen(true)
  }

  /* ---------- hands-free "Hi {pal}" ---------- */
  const [hf, setHf] = useState<{ state: HandsFreeState; progress?: number; error?: string }>({ state: 'off' })
  const hfPrev = useRef<HandsFreeState>('off')
  const hfOptions = (oneShot = false) => ({
    pal,
    userName: settings.userName,
    deviceOnly: !!settings.sttDeviceOnly,
    oneShot,
    // Only what's said after "Hi {pal}" ever goes to the cloud; the hint helps it spell names and Taglish
    transcribeCloud: (wav: Blob) => transcribeGroq(wav, `${PALS[pal].name}, timer, reminder, bukas, mamaya, Taglish`),
    onState: (state: HandsFreeState, info?: { progress?: number; error?: string }) => {
      const prev = hfPrev.current
      hfPrev.current = state
      setHf({ state, ...info })
      if (oneShot && (state === 'off' || state === 'error')) setMicOn(false)
      if (!oneShot && prev === 'loading' && state === 'listening') palSay(say(palRef.current, 'hfOn', { name: PALS[palRef.current].name }), {}, 'happy')
      if (state === 'error') palSay(say(palRef.current, info?.error === 'mic-blocked' ? 'hfMicBlocked' : 'hfError'))
    },
    // "Hi Jhyvie" … (pause): a chime and "Yes?" on screen, then the next sentence is the command
    onWake: () => {
      playChime()
      setBubble({ id: uid(), mascotId: palRef.current, text: say(palRef.current, 'hfYes'), kind: 'response' })
    },
    onCommand: (text: string) => sendRef.current(text),
    onIdle: () => palSay(say(palRef.current, 'hfIdle', { name: PALS[palRef.current].name })),
  })
  async function setHandsFree(on: boolean) {
    // Talking to Pal means Pal talks back
    setSettings((s) => ({ ...s, handsFree: on, ...(on ? { voiceOn: true } : {}) }))
    if (!on) {
      await stopHandsFree()
      return palSay(say(pal, 'hfOff'))
    }
    voiceOnRef.current = true
    unlockChime()
    await startHandsFree(hfOptions())
  }
  // Switching pal or name mid-listen: wake on the new name
  useEffect(() => {
    if (isHandsFreeOn() && !micOn) startHandsFree(hfOptions())
  }, [pal, settings.userName, settings.sttDeviceOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  // Dev only: drive hands-free without a microphone (__palHandsFreeNoMic, then __palHear("hi jhyvie …")),
  // and run the audio pipeline on Kokoro's voice (__palVoiceTest). Not in production builds.
  useEffect(() => {
    // A constant-false branch in production, so the test code isn't even bundled
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      w.__palHandsFreeNoMic = () => {
        setSettings((s) => ({ ...s, handsFree: true, voiceOn: true }))
        return startHandsFree({ ...hfOptions(), noMic: true })
      }
      w.__palHear = (text: string) => import('./lib/handsfree').then((m) => m.simulateHeard(text))
      w.__palVoiceTest = () => import('./lib/voice.selftest').then((m) => m.runVoiceSelfTest())
    }
  })
  // Quiet hours (11pm–7am): stop listening, unless a timer still needs a "stop"
  useEffect(() => {
    if (!isHandsFreeOn() || micOn || !isQuiet(now)) return
    if (alarmsRef.current.timers.some((t) => !t.done) || ringingRef.current) return
    stopHandsFree()
    palSay(say(pal, 'hfQuiet'))
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps
  // After a reload, browsers only allow the mic and audio after a tap: resume on the first one
  useEffect(() => {
    if (!settings.handsFree || hf.state !== 'off') return
    const resume = () => { if (!isQuiet(Date.now())) startHandsFree(hfOptions()) }
    window.addEventListener('pointerdown', resume, { once: true })
    return () => window.removeEventListener('pointerdown', resume)
  }, [settings.handsFree, hf.state]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- voice timers & reminders ---------- */
  const setAlarmsNow = (a: Alarms) => {
    alarmsRef.current = a
    setAlarms(a)
  }
  // A warning, the end, or a reminder: said out loud (when voice is on), chimed, and shown wherever you are
  const onAlarm = (al: Alert) => {
    const p = palRef.current
    const line = al.kind === 'warn' ? say(p, 'timerWarn', { w: sayLength(Math.round(al.leftMs / 1000)) })
      : al.kind === 'done' ? say(p, 'timerDone') : say(p, 'reminderNow', { what: al.reminder.text })
    palSay(line, {}, 'alert')
    playChime()
    if (document.hidden) notifyWeb(PALS[p].name, line)
    if (viewRef.current !== 'home') toast({ text: line })
    if (al.kind === 'done') setRinging(al.timer.id)
  }
  const onAlarmRef = useRef(onAlarm)
  onAlarmRef.current = onAlarm
  // Check every second while something is counting, and right away when the tab or phone wakes up
  const alarmsLive = alarms.timers.some((t) => !t.done && !isTimerPaused(t)) || alarms.reminders.some((r) => !r.done)
  useEffect(() => {
    if (!alarmsLive) return
    const check = () => {
      const { next, alerts } = tickAlarms(alarmsRef.current, Date.now())
      if (!alerts.length) return
      setAlarmsNow(next)
      alerts.forEach((al) => onAlarmRef.current(al))
    }
    check()
    const i = setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', check) }
  }, [alarmsLive])
  // Native alarms for everything still ahead, so a locked phone still rings
  useEffect(() => {
    scheduleTimerAlarms(upcomingAlarms(alarms, Date.now()).map((x) => ({
      at: x.at,
      title: PALS[palRef.current].name,
      body: x.kind === 'warn' ? `${x.label}: almost done!` : x.kind === 'done' ? `${x.label}: time's up!` : x.label,
    })))
  }, [alarms])
  const stopRinging = () => {
    setRinging(null)
    setAlarmsNow({ ...alarmsRef.current, timers: alarmsRef.current.timers.filter((t) => !t.done) })
  }
  // Ring until stopped, for at most a minute
  useEffect(() => {
    if (!ringing) return
    const i = setInterval(() => playChime(), 2500)
    const t = setTimeout(stopRinging, 60_000)
    return () => { clearInterval(i); clearTimeout(t) }
  }, [ringing]) // eslint-disable-line react-hooks/exhaustive-deps

  /** "What's next?": the next thing on the calendar, said plainly */
  function nextLine() {
    const n = nowRef.current
    const up = ev.current.filter((e) => e.status === 'planned' && e.kind !== 'deadline' && e.kind !== 'commute' && e.end > n).sort((a, b) => a.start - b.start)
    const first = up[0]
    if (!first || startOfDay(first.start) > startOfDay(n) + DAY) return say(pal, 'nothingNext')
    const today = up.filter((e) => startOfDay(e.start) === startOfDay(n))
    const when = startOfDay(first.start) === startOfDay(n) ? fmtTime(first.start) : `${fmtDay(first.start)} ${fmtTime(first.start)}`
    const more = today.length > 1 ? ` ${today.length - 1} more after that today.` : ''
    return say(pal, first.start <= n ? 'nowOn' : 'nextUp', { what: `${first.title}, ${when}`, more })
  }

  /** Timers, reminders, the Study session and "what's next": exact, instant, no AI needed */
  function runCommand(c: Command) {
    const now = Date.now()
    const a = alarmsRef.current
    const t = newestTimer(a)
    if (c.type === 'setTimer') {
      unlockChime()
      setAlarmsNow(startTimer(a, c.seconds, now, { warnSeconds: c.warnSeconds }))
      return palSay(say(pal, 'timerSet', { len: sayLength(c.seconds) }) + (c.warnSeconds && c.warnSeconds < c.seconds ? say(pal, 'timerWarnNote', { w: sayLength(c.warnSeconds) }) : ''), {}, 'happy')
    }
    if (c.type === 'setReminder') {
      unlockChime()
      setAlarmsNow(addReminder(a, c.at, c.text))
      return palSay(say(pal, 'reminderSet', { time: startOfDay(c.at) === startOfDay(now) ? fmtTime(c.at) : `${fmtDay(c.at)} ${fmtTime(c.at)}`, what: c.text }), {}, 'happy')
    }
    if (c.type === 'timer') {
      if (!t) return palSay(say(pal, 'noTimer'))
      if (c.op === 'left') return palSay(say(pal, 'timerLeft', { left: sayLength(Math.round(timeLeft(t, now) / 1000)) }))
      if (c.op === 'add' && c.seconds) {
        const next = addTime(a, t.id, c.seconds, now)
        setAlarmsNow(next)
        return palSay(say(pal, 'timerAdded', { len: sayLength(c.seconds), left: sayLength(Math.round(timeLeft(newestTimer(next)!, now) / 1000)) }))
      }
      if (c.op === 'pause') {
        setAlarmsNow(pauseTimer(a, t.id, now))
        return palSay(say(pal, 'timerPaused', { left: fmtLeft(timeLeft(t, now)) }))
      }
      if (c.op === 'resume') {
        setAlarmsNow(resumeTimer(a, t.id, now))
        return palSay(say(pal, 'timerResumed', { left: fmtLeft(timeLeft(t, now)) }))
      }
      setAlarmsNow(cancelTimer(a, t.id))
      return palSay(say(pal, 'timerCancelled'))
    }
    if (c.type === 'study') {
      const s = sessionRef.current
      if (c.op === 'start') {
        if (s.phase === 'idle') studyStart()
        else if (isPaused(s)) studyResume()
        return palSay(say(pal, 'focusStart'), {}, 'happy')
      }
      if (s.phase === 'idle') return palSay(say(pal, 'noStudy'))
      if (c.op === 'left') return palSay(say(pal, 'studyLeft', { phase: phaseLabel(s), left: fmtLeft(remaining(s, now)) }))
      if (c.op === 'pause') studyPause()
      else if (c.op === 'resume') studyResume()
      else if (c.op === 'skip') studySkip()
      else studyStop()
      return palSay(say(pal, c.op === 'stop' ? 'sessionDone' : c.op === 'skip' ? 'studySkipped' : c.op === 'pause' ? 'studyPaused' : 'focusStart', { m: todayFocus }))
    }
    palSay(nextLine())
  }

  // Daily brief on the first open of the day, built only from app-computed facts
  useEffect(() => {
    if (!settings.onboarded || isQuiet(Date.now())) return
    const today = new Date().toDateString()
    if (settings.lastBrief === today) return
    const id = setTimeout(async () => {
      const w = (await Promise.race([refreshWeather(), new Promise<null>((r) => setTimeout(() => r(null), 4000))])) ?? getCachedWeather()
      if (w) setWeather(w)
      const s = buildContext(Date.now(), ev.current, tk.current, w, settings.prefs, { user: settings.userName })
      const h = new Date().getHours()
      palSay([
        `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${settings.userName?.trim() ? `, ${settings.userName.trim()}` : ''}!`,
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
  /** replaces: planned blocks the new plan takes over (removed only on Accept). perDay: fill each day up to that many hours. */
  function offer(task: Task, hours: number, base: CalEvent[], lead: string, opts: { replaces?: string[]; perDay?: number } = {}) {
    const p = propose(task, hours, base, nowRef.current, settings.energy, settings.prefs, opts.perDay)
    const next = [...base, ...p.blocks]
    setEvents(next)
    const commute = task.kind === 'exam' && base.some((e) => e.kind === 'commute' && e.start > nowRef.current && e.start < task.due && !e.note)
    const card: Card = { type: 'proposal', taskId: task.id, blockIds: p.blocks.map((b) => b.id), why: p.why, shortfall: p.shortfall, freeHours: p.freeHours, commute, replaces: opts.replaces?.length ? opts.replaces : undefined }
    // An older plan for the same task is stale now: say so, instead of an empty card
    setMsgs((ms) => ms.map((m) => (m.card?.type === 'proposal' && m.card.taskId === task.id && !m.resolved ? { ...m, resolved: 'Replaced by a newer plan' } : m)))
    palSay(lead, { card }, p.shortfall > 0 ? 'alarmed' : 'talking')
    if (p.blocks[0]) {
      showWeekOf(p.blocks[0].start)
      flash(p.blocks.map((b) => b.id))
    }
  }

  function createTask(d: Draft, lead = say(pal, 'proposal'), perDay?: number) {
    if (!d.due || !d.hours) return
    const hasTime = new Date(d.due).getHours() !== 23
    const task: Task = { id: uid(), title: d.title, kind: d.kind, due: d.due, hours: d.hours, doneHours: 0 }
    const marker: CalEvent =
      d.kind === 'exam' && hasTime
        ? { id: uid(), title: d.title, kind: 'exam', start: d.due, end: d.due + 1.5 * HOUR, status: 'planned', taskId: task.id }
        : { id: uid(), title: d.title, kind: 'deadline', start: d.due, end: d.due, status: 'planned', taskId: task.id }
    setTasks((t) => [...t, task])
    offer(task, d.hours, [...ev.current, marker], lead, { perDay })
  }

  /** replaces: planned blocks an added event overlaps. They count as gone, but stay on the calendar until the new plan is accepted. */
  function reflow(taskId: string, base: CalEvent[], doneDelta = 0, opts: { replaces?: string[]; lead?: string } = {}) {
    const task = tk.current.find((t) => t.id === taskId)
    if (!task) return setEvents(base)
    const doneHours = task.doneHours + doneDelta
    const replaced = new Set(opts.replaces ?? [])
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, doneHours } : t)))
    // drop stale suggestions for this task, keep accepted future blocks
    const kept = base.filter((e) => !(e.taskId === taskId && e.status === 'proposed'))
    const future = kept.filter((e) => e.taskId === taskId && e.kind === 'work' && e.status === 'planned' && e.start >= nowRef.current && !replaced.has(e.id)).reduce((a, e) => a + hoursOf(e), 0)
    const left = Math.max(0, task.hours - doneHours - future)
    if (left < 0.25) {
      setEvents(kept)
      return palSay(say(pal, 'reflowNone'))
    }
    offer({ ...task, doneHours }, left, kept, opts.lead ?? say(pal, 'reflow', { h: fmtHours(left) }), { replaces: opts.replaces })
  }

  /** "Prelims review" plans toward the Prelims task already set up, instead of a duplicate task */
  function matchTask(title: string) {
    const norm = (s: string) => s.toLowerCase().replace(/\b(review|study|studying|aral|for|sa|ng|para|session)\b/g, ' ').replace(/\s+/g, ' ').trim()
    const n = norm(title)
    if (n.length < 3) return undefined
    return tk.current.find((t) => {
      const m = norm(t.title)
      return t.due > nowRef.current && m.length >= 3 && (n.includes(m) || m.includes(n))
    })
  }

  /** The model asked for study time ("find 3h before Friday", "2h every day until the 17th"). The app picks the slots. */
  function findTime(g: AiAction, lead: string) {
    const now = nowRef.current
    const due = parseIsoToLocalMs(g.due) || now + 7 * DAY
    const perDay = g.perDay && g.perDay > 0 ? Math.min(g.perDay, 8) : undefined
    // Days with room to study before the due time; today only if a full day's share still fits before 11pm
    let days = 0
    for (let d = startOfDay(now); at(d, 7) < due; d = addDays(d, 1)) if (d !== startOfDay(now) || at(d, 23) - now >= (perDay ?? 0) * HOUR) days++
    const hours = perDay ? perDay * Math.max(1, days) : g.hours || 2
    const existing = matchTask(g.title ?? '')
    if (existing) {
      const base = ev.current.filter((e) => !(e.taskId === existing.id && e.status === 'proposed'))
      return offer(existing, perDay ? hours : g.hours || Math.max(0.5, existing.hours - existing.doneHours), base, lead, { perDay })
    }
    createTask({ title: g.title?.trim() || 'Study', kind: 'assignment', due, hours }, lead, perDay)
  }

  /* ---------- chat input ---------- */
  function planTask(t: Task) {
    setCollapsed(false)
    if (mobile) setChatOpen(true)
    reflow(t.id, ev.current)
  }

  /** Show one event as a confirm card (Add it / Never mind). Older unanswered event cards are marked replaced. */
  function previewEvent(text: string, e: { title: string; kind: string; start: number; end: number; days?: number[]; until?: number }) {
    const slots = e.days?.length ? occurrences(e.start, e.end, e.days, nowRef.current, e.until) : [{ start: e.start, end: e.end }]
    const conflicts = ev.current.filter((x) => x.kind === 'work' && (x.status === 'planned' || x.status === 'proposed') && slots.some((s) => x.start < s.end && x.end > s.start)).length
    const first = slots[0] ?? { start: e.start, end: e.end }
    setMsgs((ms) => ms.map((m) => (m.card?.type === 'event' && !m.resolved ? { ...m, resolved: 'Changed' } : m)))
    palSay(text, { card: { type: 'event', title: e.title, kind: e.kind, start: first.start, end: first.end, conflicts, whatIf: true, days: e.days, until: e.until } }, conflicts ? 'alarmed' : 'talking')
    showWeekOf(first.start)
  }

  /** Remove or move something already on the calendar: a card first, nothing changes until the user says yes */
  function previewChange(text: string, mode: 'remove' | 'move', e: CalEvent, to?: { start: number; end: number }) {
    // The same slot on other days (a class, a daily session), so "remove all" is one tap
    const tod = (t: number) => t - startOfDay(t)
    const series = mode === 'remove'
      ? [...new Set([e.id, ...ev.current.filter((x) => x.title === e.title && x.kind === e.kind && x.status === 'planned' && x.start >= nowRef.current && tod(x.start) === tod(e.start)).map((x) => x.id)])]
      : []
    palSay(text, { card: { type: 'change', mode, eventId: e.id, title: e.title, kind: e.kind, start: e.start, end: e.end, to, seriesIds: series.length > 1 ? series : undefined } })
    showWeekOf(to?.start ?? e.start)
    flash([e.id])
  }

  /** The event this chat most recently added: what "delete mo yan" points at */
  function lastAddedEvent(ms: Msg[]) {
    const c = [...ms].reverse().find((m) => m.card?.type === 'event' && m.resolved?.startsWith('Added'))?.card
    return c?.type === 'event' ? ev.current.find((x) => x.title === c.title && x.start === c.start) : undefined
  }

  /** What a past Pal line did, in the model's own action shape, so it remembers what it proposed */
  function cardAction(m: Msg): AiAction {
    const c = m.card
    if (!c) return { type: m.rule?.includes('redirected') ? 'redirect' : 'none' }
    // Just enough to remember what it offered: every field here is paid for on every message
    if (c.type === 'event') return { type: 'addEvent', title: c.title, start: toLocalIso(c.start) }
    if (c.type === 'proposal') return { type: 'findTime', title: tk.current.find((t) => t.id === c.taskId)?.title }
    if (c.type === 'readback') return { type: 'createTask', title: c.draft.title, due: c.draft.due ? toLocalIso(c.draft.due) : undefined }
    if (c.type === 'change') return { type: c.mode === 'remove' ? 'removeEvent' : 'moveEvent', title: c.title }
    return { type: 'none' }
  }

  /** The waiting card, as the model should see it in the facts */
  function openCardOf(m?: Msg): OpenCard | null {
    const c = m?.card
    if (c?.type === 'event') return { type: 'event', title: c.title, start: c.start, end: c.end, days: c.days, until: c.until }
    if (c?.type === 'proposal') {
      const blocks = c.blockIds.map((id) => ev.current.find((e) => e.id === id)).filter((e): e is CalEvent => !!e)
      return { type: 'plan', title: tk.current.find((t) => t.id === c.taskId)?.title ?? 'your task', blocks }
    }
    if (c?.type === 'readback' && c.draft.due && c.draft.hours) return { type: 'task', title: c.draft.title, kind: c.draft.kind, due: c.draft.due, hours: c.draft.hours }
    if (c?.type === 'change') return { type: 'change', mode: c.mode, title: c.title, start: c.start, end: c.end, to: c.to }
    return null
  }

  /** The honest line when the model said it changed something it didn't */
  function claimLine(claim: Claim, act?: string, waiting?: string, ruleAct?: string) {
    if (act === 'removeEvent' || act === 'moveEvent') return say(pal, 'changeHint')
    if (claim === 'remove') return say(pal, 'nothingRemoved')
    if (claim === 'move') return say(pal, 'nothingMoved')
    if (act === 'addEvent' || ruleAct === 'addEvent' || waiting === 'event') return say(pal, 'confirmHint')
    if (act === 'findTime' || waiting === 'proposal') return say(pal, 'planHint')
    if (act === 'createTask' || waiting === 'readback') return say(pal, 'readbackHint')
    if (waiting === 'change') return say(pal, 'changeHint')
    return say(pal, 'nothingWaiting')
  }

  /** A typed yes/no to a waiting card does exactly what its buttons do */
  function answerCard(m: Msg, yes: boolean, line: string) {
    const c = m.card
    if (c?.type === 'event') {
      // The confirmation first, so a re-plan card that follows is the newest message
      palSay(line || say(pal, yes ? 'eventAdded' : 'eventSkipped', { what: `${c.title}, ${fmtDay(c.start)} ${fmtTime(c.start)}` }), {}, 'happy')
      return onCard(m.id, yes ? 'addEvent' : 'skipEvent')
    }
    if (c?.type === 'proposal') return onCard(m.id, yes ? 'accept' : 'decline', undefined, line)
    if (c?.type === 'change') return onCard(m.id, yes ? 'apply' : 'keep', undefined, line)
    if (c?.type === 'readback') {
      // The plan card comes next and still needs its own yes, so no "locked in!" from the model here
      if (yes) return onCard(m.id, 'confirm')
      resolve(m.id, 'Not added')
      setDraft(null)
      setAwaiting(null)
      palSay(line || say(pal, 'notNow'))
    }
  }

  // The last "you're on simpler replies" note, so it's said once per outage, not every message
  const noticeRef = useRef<string | null>(null)

  const sendRef = useRef(send)
  sendRef.current = send
  async function send(text: string) {
    const recent = msgs.slice(-8)
    const lastPal = [...recent].reverse().find((m) => m.from === 'pal')
    // The card a typed yes/no answers: the newest one still waiting
    const waitMsg = [...recent].reverse().find((m) => m.from === 'pal' && m.card && !m.resolved && ANSWERABLE.includes(m.card.type))
    const waitIsLatest = !!waitMsg && waitMsg.id === lastPal?.id
    // The newest event card still waiting, so "no, it's lunch" or "make it 3pm" can revise it
    const openMsg = [...recent].reverse().find((m) => m.from === 'pal' && m.card?.type === 'event' && !m.resolved)
    const openCard = openMsg?.card
    const lastEvent = openCard?.type === 'event' ? { title: openCard.title, kind: openCard.kind, start: openCard.start, end: openCard.end, days: openCard.days } : null
    // Pal's past lines carry the action they really sent (the card), so the model remembers what it proposed
    // (last 6 lines: every one is paid for again on each message)
    const history: ChatTurn[] = recent.filter((m) => m.text).slice(-6).map((m) => (m.from === 'me' ? { role: 'user', content: m.text } : { role: 'assistant', content: m.text, action: cardAction(m) }))

    setMsgs((m) => [...m, { id: uid(), from: 'me', text }])
    if (text === BRAIN_CHIP) {
      const w = await import('./lib/webllm').catch(() => null)
      if (!w || !(await w.isWebGpuSupported())) return palSay(say(pal, 'offlineNoBrain'))
      palSay(say(pal, 'brainLoading'))
      return void loadBrain()
    }
    // A ringing timer: "stop", "okay", "tama na" turns it off
    if (ringingRef.current && /^\W*(stop|ok(ay)?|tama na|got it|tigil|sige|thanks|salamat|done)\b/i.test(text)) {
      stopRinging()
      return palSay(say(pal, 'timerStopped'))
    }
    // Timers, reminders, the Study session and "what's next": rules, so they're instant and exact (no AI wait)
    const s = sessionRef.current
    const cmd = parseCommand(text, nowRef.current, {
      timers: !!newestTimer(alarmsRef.current),
      study: s.phase === 'idle' ? 'idle' : isPaused(s) ? 'paused' : 'running',
      cardWaiting: !!waitMsg,
    })
    if (cmd) {
      setLastIntent(cmd.type)
      return runCommand(cmd)
    }
    const snap = buildContext(nowRef.current, ev.current, tk.current, weather, settings.prefs, {
      card: openCardOf(waitMsg),
      cardIsLatest: waitIsLatest,
      draft: draft && awaiting && awaiting !== 'confirm' ? draft : null,
      user: settings.userName,
    })
    const t = turn(text, { pal, now: nowRef.current, draft, awaiting, pending, lastEvent, waiting: waitMsg?.card?.type ?? null, waitingIsLatest: waitIsLatest, facts: { next: snap.next, user: settings.userName } })
    const a = t.action
    feel('listening', 500)

    let groqText: string | null = null
    let groqAction: AiAction | undefined
    let usedModel: string | undefined
    let failed: AiFailure = null
    // "delete mo yan" when the model only talked about removing it: the event this chat just added
    let removeTarget: CalEvent | undefined

    // Layer 1 Guardrail: If local safety rules detected cheating, grade prediction,
    // psychiatric diagnosis, or prompt injection, bypass AI entirely and use the safe refusal.
    // Off-topic is NOT a safety block: let the AI write its own warm redirect.
    const isSafetyFilterTriggered = Boolean(t.rule && !/off-topic/.test(t.rule))

    // Any model (Groq online, Ollama or the in-browser model offline) answers every safe message, mid-task too
    if (!isSafetyFilterTriggered) {
      setTyping(true)
      const t0 = performance.now()
      try {
        const groqKey = getGroqApiKey()
        const ai = await askGroq(text, pal, groqKey, nowRef.current, history, snap, !!waitMsg)
        if (ai?.text) {
          // A reply claiming it already changed something it can't: point at the real way instead
          // "Nasa calendar mo na" about something this chat really added is true, not a claim: keep the model's words
          const trueClaim = ai.claimed === 'add' && !waitMsg && (!ai.action || ai.action.type === 'none')
            && !parseRange(text, nowRef.current) && !parseWhen(text, nowRef.current)?.hadTime && !!lastAddedEvent(recent)
          groqText = ai.claimed && !trueClaim ? claimLine(ai.claimed, ai.action?.type, waitMsg?.card?.type, a?.type) : ai.text
          groqAction = ai.action
          // Pal talked an event through in words ("i-lock ko na!") but sent no card: recover it from the chat as a card
          if (ai.claimed === 'add' && !trueClaim && !waitMsg && (!ai.action || ai.action.type === 'none') && a?.type !== 'addEvent') {
            const found = await recoverEvent([...history, { role: 'user', content: text }, { role: 'assistant', content: ai.text }], nowRef.current, groqKey)
            if (found) {
              groqAction = found
              groqText = say(pal, 'confirmHint')
            }
          }
          // "I'm removing that date!" with no action: show the Remove card for what "yan" points at, so it isn't a dead end
          if (ai.claimed === 'remove' && !waitMsg && (!ai.action || ai.action.type === 'none') && REMOVE_ASK.test(text)) {
            removeTarget = lastAddedEvent(recent)
            if (removeTarget) {
              groqAction = { type: 'removeEvent' }
              groqText = say(pal, 'removeAsk')
            }
          }
          usedModel = ai.modelUsed
          setLastLatency(Math.round(performance.now() - t0))
        } else failed = aiFailure()
      } catch {}
      setTyping(false)
    }
    // A "redirect" is only trusted when the rules engine also saw nothing to plan (e.g. "math exam tuesday" is in scope)
    if (groqAction?.type === 'redirect' && (a || t.draft)) {
      groqText = null
      groqAction = undefined
    }
    // "okkkk" / "just add it" answered with the very same card again: that's the yes, not a new proposal
    const wc = waitMsg?.card
    if (groqAction?.type === 'addEvent' && wc?.type === 'event' && parseIsoToLocalMs(groqAction.start) === wc.start && parseIsoToLocalMs(groqAction.end) === wc.end
      && (a?.type === 'confirmEvent' || /\b(add|ilagay|lagay|push|lock)\b/i.test(text))) {
      groqAction = { type: 'confirmEvent' }
      groqText = ''
    }

    // A model answered, so it leads. The rules engine only decides what's deterministic, or answers when no model could.
    const modelLed = groqText != null
    // "asaan, wala sa calendar": show them where the event Pal just added is, whoever answers
    const whereTarget = WHERE_ASK.test(text) ? lastAddedEvent(recent) : undefined
    if (whereTarget) {
      setView('week')
      showWeekOf(whereTarget.start)
      flash([whereTarget.id])
    }
    // A short, time-free "okay" / "wag na" to the newest card always answers it, even if the model re-offered
    // the same card ("yes but make it 3pm" has a time, so the rules never catch a change here).
    // A typed yes to a task card can carry a change ("yes but due friday"), so there the model's own action wins.
    const ruleAnswer = a?.type === 'confirmEvent' || a?.type === 'skipEvent' || (a?.type === 'confirmDraft' && (!groqAction || groqAction.type === 'none'))
    if (!modelLed) {
      setDraft(t.draft)
      setAwaiting(t.awaiting)
      if (t.pending !== undefined) setPending(t.pending)
    } else if (pending) setPending(null)

    setActiveModel(usedModel ?? 'Local Rules')
    setLastIntent(groqAction && groqAction.type !== 'none' && a?.type !== 'reviseEvent' && a?.type !== 'pref' ? groqAction.type : a?.type ?? (t.rule ? 'scope filter' : 'chat'))

    // Say once why replies just got simpler or slower, instead of switching voice silently
    const viaCloud = !!usedModel && CLOUD_CHAIN.includes(usedModel)
    const ci = cloudIssue()
    const notice = viaCloud ? null
      : modelLed ? (ci?.kind === 'quota' ? 'quotaLocal' : null) // your PC's model (or the in-browser one) stood in for the cloud
      : failed === 'quota' ? 'quotaOut' : failed === 'rate' ? 'busy' : failed // 'timeout' / 'error' → slowNet, 'offline' below
    if (viaCloud) noticeRef.current = null
    else if (notice && noticeRef.current !== notice) {
      noticeRef.current = notice
      if (notice === 'quotaLocal' || notice === 'quotaOut' || notice === 'busy') palSay(say(pal, notice, { time: ci ? fmtTime(ci.until) : 'later' }))
      else if (notice !== 'offline') palSay(say(pal, 'slowNet'))
      else palSay(say(pal, brain === -1 || (brain != null && brain < 1) ? 'offlineNoBrain' : 'offlineBrain'), brain == null ? { chips: [BRAIN_CHIP] } : {})
    }

    setTimeout(() => {
      // 0. A correction to the waiting card is deterministic; it wins over whatever the AI guessed
      if (a?.type === 'reviseEvent') return previewEvent(t.text, a)
      if (a?.type === 'pref') {
        setSettings((s) => ({ ...s, prefs: a.clear ? {} : { ...s.prefs, ...(a.latestHour != null ? { latestHour: a.latestHour } : {}), ...(a.blockedDays ? { blockedDays: [...new Set([...(s.prefs?.blockedDays ?? []), ...a.blockedDays])] } : {}) } }))
        return palSay(t.text, {}, 'happy')
      }

      // 1. A yes/no to the waiting card: the model read it in any wording, or the rules caught a short "oo" / "wag na"
      const g = groqAction
      const answer = ruleAnswer ? a?.type : g?.type === 'confirmEvent' || g?.type === 'skipEvent' ? g.type : !modelLed ? a?.type : undefined
      // The model's words when it read the answer the same way; otherwise the plain line for what happened
      const agrees = modelLed && g?.type === answer
      if (waitMsg && (answer === 'confirmEvent' || answer === 'skipEvent' || (answer === 'confirmDraft' && waitMsg.card?.type === 'readback')))
        return answerCard(waitMsg, answer !== 'skipEvent', (agrees ? groqText : t.text) ?? '')

      // 2. The model leads: its action becomes a card, always confirmed by the user first
      if (modelLed && g) {
        if (g.type === 'addEvent') {
          const startMs = parseIsoToLocalMs(g.start) || nowRef.current
          const endMs = parseIsoToLocalMs(g.end) || startMs + 1 * HOUR
          return previewEvent(groqText || say(pal, 'eventAdd'), {
            title: g.title?.trim() || 'Event',
            kind: g.kind || 'work',
            start: startMs,
            end: Math.max(endMs, startMs + 30 * MIN),
            days: g.days,
            until: parseIsoToLocalMs(g.until) ?? undefined,
          })
        }
        if (g.type === 'removeEvent' || g.type === 'moveEvent') {
          const e = removeTarget ?? ev.current.find((x) => x.id === snap.refs[g.id ?? ''])
          if (e && g.type === 'removeEvent') return previewChange(groqText || say(pal, 'removeAsk'), 'remove', e)
          const s = parseIsoToLocalMs(g.start)
          const end = parseIsoToLocalMs(g.end)
          if (e && s != null) return previewChange(groqText || say(pal, 'moveAsk'), 'move', e, { start: s, end: end && end > s ? end : s + (e.end - e.start) })
        }
        if (g.type === 'createTask') {
          const dueMs = parseIsoToLocalMs(g.due) || nowRef.current + 2 * DAY
          const kind = g.kind === 'exam' ? 'exam' : 'assignment'
          const d: Draft = { title: g.title?.trim() || 'Task', kind, due: dueMs, hours: g.hours || defaultHours(kind) }
          setDraft(d)
          setAwaiting('confirm')
          setMsgs((ms) => ms.map((m) => (m.card?.type === 'readback' && !m.resolved ? { ...m, resolved: 'Changed' } : m)))
          return palSay(groqText || say(pal, 'readback'), { card: { type: 'readback', draft: d } }, 'talking')
        }
        // The model picks the intent; the app does the math (slots, free time) so nothing is hallucinated
        if (g.type === 'findTime') return findTime(g, groqText || say(pal, 'proposal'))
        if (g.type === 'analyzeWeek') return palSay(groqText || `${summary()} ${snap.insight}`)
        // Free-form timer/reminder/focus wording the rules didn't catch: the app runs it and says exactly what it did
        if (g.type === 'setTimer' && g.seconds) return runCommand({ type: 'setTimer', seconds: Math.round(g.seconds), warnSeconds: g.warnSeconds ? Math.round(g.warnSeconds) : undefined })
        if (g.type === 'setReminder') {
          const at = parseIsoToLocalMs(g.start) ?? (g.seconds ? Date.now() + g.seconds * 1000 : null)
          if (at && at > Date.now()) return runCommand({ type: 'setReminder', at, text: g.note?.trim() || 'Reminder' })
        }
        if (g.type === 'timer') return runCommand({ type: 'timer', op: g.op as 'left' | 'add' | 'pause' | 'resume' | 'cancel', seconds: g.seconds })
        if (g.type === 'study') return runCommand({ type: 'study', op: g.op as 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'left' })
        if (g.type === 'redirect') return palSay(groqText ?? '', { rule: 'Scope: redirected to planning' })
      }

      // 3. App-side facts and settings the rules engine caught; with a model leading, its words go with them
      // No model, or a small one (your PC's) that only talked: "delete mo yan" still gets the Remove card for
      // what this chat just added. With a model, only for "yan/that/it": "tanggalin yung shift" names something else.
      if (whereTarget && !modelLed) return palSay(say(pal, 'whereIs', { what: `${whereTarget.title}, ${fmtDay(whereTarget.start)} ${fmtTime(whereTarget.start)}` }))
      const justAdded = !waitMsg && REMOVE_ASK.test(text) && (!modelLed || (!g || g.type === 'none') && /\b(yan|iyan|yun|iyon|ito|that|it|this)\b/i.test(text))
        ? lastAddedEvent(recent) : undefined
      if (justAdded) return previewChange(say(pal, 'removeAsk'), 'remove', justAdded)
      const replyText = groqText ?? t.text
      if (!a) return palSay(replyText, modelLed ? {} : { card: t.card, chips: t.chips, rule: t.rule })
      if (a.type === 'confirmEvent' || a.type === 'skipEvent' || a.type === 'confirmDraft') {
        if (a.type === 'confirmDraft' && !modelLed) return createTask(a.draft)
        return palSay(replyText || say(pal, 'nothingWaiting'))
      }
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
      // The model only talked, but the message had a concrete time: still a card, so "lagay mo 3pm" never dead-ends
      if (a.type === 'addEvent') return previewEvent(replyText || say(pal, a.whatIf ? 'whatIf' : 'eventAdd'), a)
      palSay(replyText)
    }, modelLed ? 0 : 380 + Math.random() * 380)
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
  /** line: what Pal says instead of the usual line, when the user answered the card in their own words */
  function onCard(id: string, action: string, arg?: string, line?: string) {
    const m = msgs.find((x) => x.id === id)
    const c = m?.card
    if (action === 'chip') return setMsgs((ms) => ms.map((x) => (x.id === id ? { ...x, chips: undefined } : x)))
    if (c?.type === 'readback') {
      if (action === 'confirm') {
        resolve(id, 'Confirmed')
        setDraft(null)
        setAwaiting(null)
        return createTask(c.draft, line || undefined)
      }
      resolve(id, 'Changing…')
      return palSay(say(pal, 'fix'))
    }
    if (c?.type === 'proposal') {
      if (action === 'accept') {
        const ids = new Set(c.blockIds)
        // Blocks this plan replaces (they overlapped something new) go only now, on Accept
        const gone = new Set(c.replaces ?? [])
        const before = ev.current
        setEvents(before.filter((e) => !gone.has(e.id)).map((e) => (ids.has(e.id) && e.status === 'proposed' ? { ...e, status: 'planned' } : e)))
        resolve(id, 'Added to your calendar')
        palSay(line || say(pal, 'accepted'))
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
        palSay(line || say(pal, 'notNow'))
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
      const repeats = c.days?.length ? occurrences(c.start, c.end, c.days, nowRef.current, c.until) : []
      const slots = repeats.length ? repeats : [{ start: c.start, end: c.end }]
      const added: CalEvent[] = slots.map((s) => ({ id: uid(), title: c.title, kind: c.kind as CalEvent['kind'], start: s.start, end: s.end, status: 'planned' }))
      const hit = ev.current.filter((e) => e.kind === 'work' && (e.status === 'planned' || e.status === 'proposed') && added.some((a) => e.start < a.end && e.end > a.start))
      // Unaccepted suggestions under it go now. Accepted study blocks stay until the user accepts new times for them.
      const base = [...ev.current.filter((e) => !(hit.includes(e) && e.status === 'proposed')), ...added]
      showWeekOf(added[0].start)
      setView('week')
      // Keep the chat open when a re-plan card is coming, so its Accept button is in reach
      if (mobile && !c.conflicts) setChatOpen(false)
      resolve(id, c.conflicts ? 'Added. New times for the overlap below' : added.length > 1 ? `Added ${added.length} sessions${c.until ? ` until ${fmtDay(c.until)}` : ' over the next 8 weeks'}` : 'Added')
      setTimeout(() => feel('happy', 1400), 60)
      const affected = [...new Set(hit.map((e) => e.taskId).filter(Boolean))] as string[]
      if (affected.length) {
        const replaces = hit.filter((e) => e.status === 'planned' && e.taskId === affected[0]).map((e) => e.id)
        reflow(affected[0], base, 0, { replaces, lead: say(pal, 'conflictReflow', { what: c.title }) })
      } else {
        setEvents(base)
        flash(added.map((a) => a.id))
      }
      return
    }
    if (c?.type === 'change') {
      if (action === 'keep') {
        resolve(id, 'Kept')
        return palSay(line || say(pal, 'kept'))
      }
      const before = ev.current
      const ids = new Set(action === 'removeAll' && c.seriesIds?.length ? c.seriesIds : [c.eventId])
      if (!before.some((e) => ids.has(e.id))) return resolve(id, 'Already gone')
      const undo = { label: 'Undo', fn: () => { setEvents(before); resolve(id, '') } }
      if (c.mode === 'remove') {
        setEvents(before.filter((e) => !ids.has(e.id)))
        resolve(id, ids.size > 1 ? `Removed ${ids.size}` : 'Removed')
        toast({ text: `Removed “${c.title}”${ids.size > 1 ? ` ×${ids.size}` : ''}`, action: undo })
        palSay(line || say(pal, 'removed', { what: c.title }), {}, 'happy')
      } else if (c.to) {
        const to = c.to
        setEvents(before.map((e) => (e.id === c.eventId ? { ...e, start: to.start, end: to.end } : e)))
        resolve(id, 'Moved')
        showWeekOf(to.start)
        flash([c.eventId])
        toast({ text: `Moved “${c.title}”`, action: undo })
        palSay(line || say(pal, 'moved', { what: c.title }), {}, 'happy')
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
    // No speech service here (the Android app, Firefox): hear one sentence with the on-device Whisper instead
    if (!SR) {
      if (!navigator.mediaDevices?.getUserMedia) return micFail('unsupported')
      if (isHandsFreeOn()) {
        if (micOn) { setMicOn(false); return void stopHandsFree() }
        return expectFollowUp()
      }
      setMicOn(true)
      return void startHandsFree(hfOptions(true))
    }
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

  function finishOnboarding(v: { pal: PalId; name: string; energy: Energy; advancedMode?: boolean; userName?: string }) {
    const first = !settings.onboarded
    setSettings((s) => ({ ...s, ...v, onboarded: true, advancedMode: v.advancedMode ?? s.advancedMode ?? false }))
    setEditing(false)
    if (first)
      setTimeout(() => {
        setMsgs([])
        setBubble({ id: uid(), mascotId: v.pal, text: greetLine(v.pal, v.userName), kind: 'greeting' })
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
      micOn={micOn} toggleMic={toggleMic} micSupported={!!SR || !!navigator.mediaDevices?.getUserMedia} interim={interim} compact={mobile} noPal={(view === 'home' || view === 'study') && !chatOpen}
      handsFree={{ on: !!settings.handsFree, state: hf.state, progress: hf.progress, toggle: () => setHandsFree(!settings.handsFree) }}
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
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 pb-1" style={{ paddingRight: clusterW ? clusterW + 24 : undefined }}>
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
            <div ref={clusterRef} className="absolute top-3 right-3 z-30 flex items-center gap-2">
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
          handsFree={{
            on: !!settings.handsFree,
            toggle: () => setHandsFree(!settings.handsFree),
            deviceOnly: !!settings.sttDeviceOnly,
            setDeviceOnly: (v) => setSettings((s) => ({ ...s, sttDeviceOnly: v })),
          }}
        />
      )}
      {editing && (
        <button onClick={resetDemo} className="fixed bottom-4 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-paper px-4 py-2 text-[12.5px] text-ink-2 shadow-[var(--shadow-lg)]">Reset demo week</button>
      )}
      <TimerPill
        timers={alarms.timers}
        ringing={ringing}
        onPause={(id) => setAlarmsNow(pauseTimer(alarmsRef.current, id, Date.now()))}
        onResume={(id) => setAlarmsNow(resumeTimer(alarmsRef.current, id, Date.now()))}
        onCancel={(id) => setAlarmsNow(cancelTimer(alarmsRef.current, id))}
        onStop={stopRinging}
      />
      <Toasts items={toasts} dismiss={dismiss} />
    </div>
  )
}

