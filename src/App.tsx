import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { say, turn, type Awaiting, type Card, type Draft, type PendingEvent } from './lib/agent'
import { addDays, DAY, fmtDay, fmtHours, fmtTime, HOUR, hoursOf, MIN, seedWeek, startOfDay, startOfWeek, uid, type CalEvent, type PalId, type PalState, type Task } from './lib/core'
import { propose, type Energy } from './lib/schedule'
import { Calendar, LoadStrip } from './components/Calendar'
import { Chat, type Msg, type MascotBubble } from './components/Chat'
import { BlockPopover, Onboarding, SyllabusSheet, Toasts, type SyllabusItem, type Toast } from './components/Overlays'
import { ChevronL, ChevronR, Clock, Moon, Sun, Wordmark } from './components/Icons'
import { Pal, PALS } from './pals/Pal'
import { Rail, TabBar, type View } from './components/Nav'
import { Today } from './components/Today'
import { Tasks } from './components/Tasks'
import { loadKokoro, speakKokoro, stopKokoro } from './lib/voice'

const KEY = 'paldo-v1'
const QUIET: [number, number] = [23, 7]
const MAX_CHECKINS = 3
const VOICE_PITCH: Record<PalId, number> = { rei: 1.1, diel: 0.9, jhyvie: 1.3, jaypee: 1.05 }

interface Settings { pal: PalId; name: string; energy: Energy; onboarded: boolean; voiceOn: boolean; notify: boolean; notifyAsked: boolean }
interface Saved { settings: Settings; events: CalEvent[]; tasks: Task[]; msgs: Msg[]; asked: string[]; alerted: string[]; log: Record<string, number>; offset: number }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '')
    if (s?.settings) return { ...s, msgs: (s.msgs as Msg[]).filter((m) => m.from === 'me' || m.card || m.chips) }
  } catch {}
  const { events, tasks } = seedWeek(Date.now())
  return {
    settings: { pal: 'rei', name: 'Rei', energy: 'afternoon', onboarded: false, voiceOn: false, notify: false, notifyAsked: false },
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
  const [syllabus, setSyllabus] = useState(false)
  const [editing, setEditing] = useState(false)
  const [weekOff, setWeekOff] = useState(0)
  const [dayIdx, setDayIdx] = useState((new Date().getDay() + 6) % 7)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  const [chatOpen, setChatOpen] = useState(false) // mobile drawer
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
    localStorage.setItem(KEY, JSON.stringify({ settings, events, tasks, msgs: msgs.slice(-80), asked, alerted, log, offset } satisfies Saved))
  }, [settings, events, tasks, msgs, asked, alerted, log, offset])
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
  voiceOnRef.current = settings.voiceOn
  const speak = useCallback((text: string, force = false) => {
    if ((!voiceOnRef.current && !force) || !text) return
    // Offline Kokoro voice first; the browser voice only covers while it loads
    const quiet = () => setMood((m) => (m?.state === 'talking' ? null : m))
    if (speakKokoro(text, pal, () => feel('talking', 60_000), quiet)) {
      window.speechSynthesis?.cancel()
      return
    }
    if (!('speechSynthesis' in window)) return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
    // Fallback voice: match the pal's gender (Rei and Jhyvie are girls, Diel and Jaypee are boys)
    const FEMALE = /female|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|libby|sonia|natasha|hazel|susan|serena|ava|allison|emma|michelle|google us english/i
    const MALE = /\bmale|daniel|alex\b|fred|david|guy|ryan|mark|george|thomas|aaron|arthur|oliver|christopher|eric|google uk english male/i
    const girl = pal === 'rei' || pal === 'jhyvie'
    const pool = en.filter((v) => (girl ? FEMALE.test(v.name) && !/\bmale/i.test(v.name.replace(/female/i, '')) : MALE.test(v.name) && !/female/i.test(v.name)))
    const pick = pool[pal === 'jhyvie' || pal === 'jaypee' ? Math.min(1, pool.length - 1) : 0] ?? en[0]
    if (pick) u.voice = pick
    u.lang = pick?.lang ?? 'en-US'
    u.pitch = VOICE_PITCH[pal]
    u.rate = pal === 'jaypee' ? 1.1 : 1
    // Chrome pauses long utterances after ~15s; nudging resume keeps it going
    let keep = 0
    u.onstart = () => {
      feel('talking', 60_000)
      keep = window.setInterval(() => speechSynthesis.speaking && speechSynthesis.resume(), 10_000)
    }
    const stop = () => {
      clearInterval(keep)
      setMood((m) => (m?.state === 'talking' ? null : m))
    }
    u.onend = stop
    u.onerror = stop
    // a tick after cancel(), or Chrome sometimes drops the utterance
    setTimeout(() => speechSynthesis.speak(u), 40)
  }, [pal, voices])

  const recRef = useRef<any>(null)
  const SR = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null

  /* ---------- messaging helpers ---------- */
  const toast = (t: Omit<Toast, 'id'>) => setToasts((x) => [...x.slice(-2), { id: uid(), ...t }])
  const dismiss = useCallback((id: string) => setToasts((x) => x.filter((t) => t.id !== id)), [])
  const palSay = (text: string, extra: Partial<Msg> = {}, state: PalState = 'talking') => {
    setBubble({ id: uid(), mascotId: palRef.current, text, kind: 'response' })
    // Only actionable replies enter the feed (their card/chips need a home); the text stays in the bubble
    if (extra.card || extra.chips) setMsgs((m) => [...m, { id: uid(), from: 'pal', text, ...extra }])
    feel(state, state === 'talking' ? Math.min(2600, 500 + text.length * 28) : 1800)
    speak(text)
  }
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
    const p = propose(task, hours, base, nowRef.current, settings.energy)
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

  function createTask(d: Draft) {
    if (!d.due || !d.hours) return
    const hasTime = new Date(d.due).getHours() !== 23
    const task: Task = { id: uid(), title: d.title, kind: d.kind, due: d.due, hours: d.hours, doneHours: 0 }
    const marker: CalEvent =
      d.kind === 'exam' && hasTime
        ? { id: uid(), title: d.title, kind: 'exam', start: d.due, end: d.due + 1.5 * HOUR, status: 'planned', taskId: task.id }
        : { id: uid(), title: d.title, kind: 'deadline', start: d.due, end: d.due, status: 'planned', taskId: task.id }
    setTasks((t) => [...t, task])
    offer(task, d.hours, [...ev.current, marker], say(pal, 'proposal'))
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

  const sendRef = useRef(send)
  sendRef.current = send
  function send(text: string) {
    setMsgs((m) => [...m, { id: uid(), from: 'me', text }])
    const t = turn(text, { pal, now: nowRef.current, draft, awaiting, pending })
    setDraft(t.draft)
    setAwaiting(t.awaiting)
    if (t.pending !== undefined) setPending(t.pending)
    feel('listening', 500)
    setTimeout(() => {
      const a = t.action
      if (!a) return palSay(t.text, { card: t.card, chips: t.chips, rule: t.rule })
      if (a.type === 'confirmDraft') return createTask(a.draft)
      if (a.type === 'openSyllabus') {
        palSay(t.text)
        return setSyllabus(true)
      }
      if (a.type === 'energy') {
        setSettings((s) => ({ ...s, energy: a.value }))
        return palSay(t.text)
      }
      if (a.type === 'summary') return palSay(summary())
      if (a.type === 'addEvent') {
        const slots = a.days?.length ? occurrences(a.start, a.end, a.days, nowRef.current) : [{ start: a.start, end: a.end }]
        const conflicts = ev.current.filter((e) => e.kind === 'work' && (e.status === 'planned' || e.status === 'proposed') && slots.some((s) => e.start < s.end && e.end > s.start)).length
        const first = slots[0] ?? { start: a.start, end: a.end }
        palSay(say(pal, a.whatIf ? 'whatIf' : 'eventAdd'), { card: { type: 'event', title: a.title, kind: a.kind, start: first.start, end: first.end, conflicts, whatIf: a.whatIf, days: a.days } }, conflicts ? 'alarmed' : 'talking')
        showWeekOf(first.start)
      }
    }, 380 + Math.random() * 380)
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
      if (action === 'notifyOn' && 'Notification' in window) {
        Notification.requestPermission().then((p) => setSettings((s) => ({ ...s, notify: p === 'granted' })))
        resolve(id, 'Reminders on')
      } else resolve(id, 'In-app reminders only')
    }
  }

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

  function finishOnboarding(v: { pal: PalId; name: string; energy: Energy }) {
    const first = !settings.onboarded
    setSettings((s) => ({ ...s, ...v, onboarded: true }))
    setEditing(false)
    if (first)
      setTimeout(() => {
        setMsgs([])
        setBubble({ id: uid(), mascotId: v.pal, text: say(v.pal, 'greet'), kind: 'greeting' })
        feel('wave', 1600)
      }, 250)
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
      micOn={micOn} toggleMic={toggleMic} micSupported={!!SR} interim={interim} compact={mobile} noPal={view === 'home' && !chatOpen}
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
      {weekOff !== 0 && <button onClick={() => setWeekOff(0)} className="pop press ml-1 h-8 rounded-full bg-tangerine-soft px-3 text-[12px] font-medium text-ink">This week</button>}
    </div>
  )

  const content =
    view === 'home' ? (
      <Today now={now} events={events} tasks={tasks} onOpen={openPop} onPlan={planTask} onWeek={goWeek} pal={pal} palName={name} palState={palState} onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)} onTalk={() => (mobile ? setChatOpen(true) : setCollapsed(false))} />
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
            {palSwitch}
            {themeBtn}
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
            <TabBar view={view} setView={(v) => { setView(v); setChatOpen(false) }} taskCount={openTasks} />
          </div>
        </>
      ) : (
        <>
          <Rail view={view} setView={setView} onSyllabus={() => setSyllabus(true)} onSettings={() => setEditing(true)} taskCount={openTasks} dark={dark} onTheme={() => setDark((d) => !d)} />
          <aside
            className={`liquid relative min-h-0 shrink-0 overflow-hidden rounded-[30px] ${instant ? '' : 'transition-[width,opacity,transform,margin] duration-[260ms] [transition-timing-function:var(--ease-out)]'} ${collapsed ? 'pointer-events-none -mr-4 w-0 -translate-x-4 opacity-0' : 'w-[clamp(400px,34vw,520px)]'}`}
            aria-hidden={collapsed}
          >
            <div className="h-full w-[clamp(400px,34vw,520px)]">{chat}</div>
          </aside>
          <section className="liquid relative min-h-0 flex-1 overflow-hidden rounded-[30px]">
            <div className="absolute top-3 right-3 z-30">{palSwitch}</div>
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
      {syllabus && <SyllabusSheet now={now} onClose={() => setSyllabus(false)} onAdd={addSyllabus} />}
      {(!settings.onboarded || editing) && (
        <Onboarding initial={settings.onboarded ? settings : undefined} onDone={finishOnboarding} />
      )}
      {editing && (
        <button onClick={resetDemo} className="fixed bottom-4 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-paper px-4 py-2 text-[12.5px] text-ink-2 shadow-[var(--shadow-lg)]">Reset demo week</button>
      )}
      <Toasts items={toasts} dismiss={dismiss} />
    </div>
  )
}

