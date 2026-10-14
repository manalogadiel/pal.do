import {titleNeedsConfirmation} from './lib/title-confidence'
import TravelPlanner from './components/TravelPlanner'
import {parseTravelIntent,type TravelDraft} from './lib/travel'
import ScheduleEditor from './components/ScheduleEditor'
import {applyScheduleEdit,resolveEditorOriginal,synchronizeScheduleOwner,type ScheduleDraft} from './lib/schedule-edit'
import {buildPalKnowledge,answerKnowledgeQuestion} from './lib/pal-knowledge'
import AttachmentPlacement, {type AttachmentDestination} from './components/AttachmentPlacement'
import { reconcileTaskCalendar, normalizeTask, datedTasks, isTaskDone, newTask, applyTaskEdit, syncTaskCalendar, transitionTask, type TaskDraft } from './lib/tasks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ANSWERABLE, defaultHours, greetLine, say, turn, type Awaiting, type Card, type Draft, type PendingEvent } from './lib/agent'
import { addDays, at, DAY, fmtDay, fmtHours, fmtTime, HOUR, hoursOf, MIN, seedWeek, startOfDay, startOfWeek, uid, type CalEvent, type PalId, type PalState, type Task } from './lib/core'
import { clashes, freeGaps, nearestFree, resolveClash, occurrences, propose, type Energy, type Prefs } from './lib/schedule'
import { buildContext, type OpenCard } from './lib/context'
import { isYes, namedDay, parseHours, parseRange, parseWhen } from './lib/parse'
import { isEcho, matchWake, stripWakePhrase, wrongPal } from './lib/wake'
import { recognitionLanguage, readRecognitionResults } from './lib/speech-input'
import { suggestedSlotReply } from './lib/event-choice'
import { acceptWeatherRefresh,getWeatherLocation,outdoorWeatherAdvice, WEATHER_EVENT, getCachedWeather, refreshWeather, weatherLine, type Weather } from './lib/weather'
import { Calendar, LoadStrip } from './components/Calendar'
import TaskEditor from './components/TaskEditor'
import { Chat, type Msg, type MascotBubble } from './components/Chat'
import { BlockPopover, DeletePlansSheet, scanDeadlines, SyllabusSheet, Toasts, type SyllabusItem, type Toast } from './components/Overlays'
import ClassScheduleImport, { conflictKey } from './components/ClassScheduleImport'
import { reviewClassImport, type ClassDraft } from './lib/class-schedule'
import { supportedScheduleFile } from './lib/schedule-source'
import Welcome from './components/Welcome'
import SettingsScreen from './components/Settings'
import { answerScheduleQuestion, parseScheduleQuestion } from './lib/schedule-answers'
import { dayInsights, newInsights, weekInsights } from './lib/insights'
import { ChevronD, ChevronL, ChevronR, Clock, Gear, Moon, Sun, Trash, Wordmark } from './components/Icons'
import { Pal, PALS } from './pals/Pal'
import { Rail, TabBar, type View } from './components/Nav'
import { Today } from './components/Today'
import { Tasks } from './components/Tasks'
import { stopKokoro } from './lib/voice'
import { hasNativeTts, speakNative, stopNative, speakPal, stopSpeech } from './lib/native-tts'
import { LIBRARY_EVENT, deleteFolder, getFile, listFiles, listFolders, newFolder, saveFolder, type Folder, type LibraryFile } from './lib/library'
import { importFile } from './lib/study-files'
import { studyHours, suggestFolder, terms, titleFromFileName, topicsOf } from './lib/study-material'
import type { LibraryMode, LibraryTarget } from './components/Library'
import { cancelSessionAlarms, enableAlarms, isNative, notifyWeb, playChime, playMicSound, playSound, scheduleSessionAlarms, scheduleTimerAlarms, setSoundsOn, syncEventAlarms, unlockChime } from './lib/notifications'
import { focusElapsed, fromSaved, isPaused, LONG_EVERY, pause, phaseEnds, phaseLabel, remaining, resume, skip, start, stop, tick, active, running, countUp, configure, validateConfig, finish, nextRound, checkpoint, recoverAway, DEFAULT_CONFIG, type StudyConfig, type Session } from './lib/session'
import { addReminder, addTime, cancelTimer, fmtLeft, isPaused as isTimerPaused, newestTimer, NO_ALARMS, pauseTimer, resumeTimer, sayLength, startTimer, tickAlarms, timeLeft, upcomingAlarms, type Alarms, type Alert } from './lib/timers'
import { parseCommand, type Command } from './lib/commands'
import { TimerPill } from './components/TimerPill'
import { expectFollowUp, handOffListening, isHandsFreeOn, resumeAudio, resumeListening, setPalSpeaking, startHandsFree, stopHandsFree, type HandsFreeState } from './lib/handsfree'
import { Study, StudyTabs } from './components/Study'
import { FloatingCompanionManager, useFloatingCompanion } from './components/FloatingCompanion'
import { aiFailure, alignToMessage, askGroq, CLOUD_CHAIN, cloudIssue, cloudReady, getGroqApiKey, getLocalAiUrl, hasCloudAi, parseIsoToLocalMs, preloadOllama, PRIMARY_MODEL, recoverEvent, toLocalIso, transcribeGroq, type AiAction, type AiFailure, type ChatTurn, type Claim } from './lib/groq'
import { StatusBadge } from './components/StatusBadge'
import { AI_MODE_EVENT, getAiMode, isPhoneAiPlatform } from './lib/ai-mode'
import { AiRequestGate } from './lib/ai-request'
import { chooseProvider, getNativeFailure, phoneModelAnswers } from './lib/groq'
import { automaticModelSetup, nativeErrorMessage, phoneAi } from './lib/native-ai'
import { describeFocus, emptyFocus, eventFromFocus, isGreeting, isQuestion, removePreviewedEvents, resolveStudyRequest, selectStudyGroup, updateConversationFocus, type ConversationFocus } from './lib/conversation'

const KEY = 'paldo-v1'
const QUIET: [number, number] = [23, 7]
const MAX_CHECKINS = 3
/** Talking to Pal: the request is sent after this much quiet following their last words (every mic path) */
const SEND_AFTER_SILENCE_MS = 2000
/** The mic just opened and nothing's been heard yet: it closes after this */
const NOTHING_SAID_MS = 3000
/** A voice was heard but no words have arrived yet (the recognizer lags about a second behind) */
const WORDS_PENDING_MS = 4000
const MAX_TALK_MS = 30_000
const VOICE_PITCH: Record<PalId, number> = { rei: 1.1, diel: 0.9, jhyvie: 1.3, jaypee: 1.05 }

interface Settings { pal: PalId; name: string; energy: Energy; onboarded: boolean; voiceOn: boolean; notify: boolean; notifyAsked: boolean; advancedMode?: boolean; prefs?: Prefs; lastBrief?: string; userName?: string; handsFree?: boolean; sttDeviceOnly?: boolean }
interface Saved { settings: Settings; events: CalEvent[]; tasks: Task[]; msgs: Msg[]; asked: string[]; alerted: string[]; log: Record<string, number>; offset: number; session?: Session; focusLog?: Record<string, number>; alarms?: Alarms; conversation?: ConversationFocus; loadWarning?: string }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '')
    if (s?.settings) {
      const raw: unknown[] = Array.isArray(s.tasks) ? s.tasks : []
      const tasks = raw.map(t=>normalizeTask(t,Date.now())).filter((t): t is Task=>!!t)
      const invalid = raw.length-tasks.length
      if(invalid) localStorage.setItem('paldo-v1-recovery',JSON.stringify(s))
      return { ...s, tasks, msgs: (s.msgs as Msg[]) || [], loadWarning: invalid ? `${invalid} unreadable task record(s) were kept in a recovery copy on this device.` : undefined }
    }
  } catch {}
  const { events, tasks } = seedWeek(Date.now())
  return {
    settings: { pal: 'rei', name: 'Rei', energy: 'afternoon', onboarded: false, voiceOn: false, notify: false, notifyAsked: false, advancedMode: false },
    events, tasks, msgs: [], asked: [], alerted: [], log: {}, offset: 0,
  }
}

/** "delete mo yan", "tanggalin mo", "cancel that" */
const SIGN_OFF = String.raw`(?:thanks?(?: you)?|thank u|thx|ty|salamat|maraming salamat|bye(?:[- ]?bye)?|goodbye|good ?night|see (?:you|ya)(?: later| tomorrow)?|later|that'?s (?:all|it)|nothing else|no more|i'?m good|im good|all good|we'?re good|all set|done|okay na|ok na|tama na|wala na|yun lang|yon lang|ayos na)`
const DISMISSAL = new RegExp(String.raw`^\W*(?:(?:ok(?:ay)?|alright|sige|cge|oh|cool|great|nice|perfect|got it|no|nope)[\s,.!]+)*${SIGN_OFF}(?:[\s,.!]+(?:${SIGN_OFF}|po|so much|a lot|again|for now|na|rei|diel|jhyvie|jaypee|jp|jv|pal))*\W*$`, 'i')
const REMOVE_ASK = /\b(delete|remove|tanggal\w*|bura\w*|alis\w*|cancel)\b/i
/** "add anyway", "ok lang", "yung original": keep the asked time even though it overlaps */
/** Phone-model errors the user can fix (import a model, free space); anything else is just a missed reply */
const NATIVE_SETUP_ISSUES = ['MISSING_MODEL', 'UNSUPPORTED_ARCH', 'INVALID_MODEL', 'INSUFFICIENT_SPACE', 'LOAD_FAILED', 'PROMPT_TOO_LONG']
/** "What plan does it block?", "anong tatamaan?", "what does it overlap with": about the waiting card's clashes */
const OVERLAP_ASK = /\b(what|which|whats|what's|ano|anong|alin|alin ang)\b.*\b(block|blocks|blocking|overlaps?|overlapping|clash(es)?|conflicts?|tatamaan|matatamaan|natatamaan|sagasa\w*)\b|\b(block|overlap)s? (what|which)\b/i
const ADD_ANYWAY =/\b(any ?ways?|kahit (na )?(overlap|sabay|ganun|ganon|ganyan)|ok(ay)? lang|ituloy|tuloy (mo|na|lang)|(yung|the) (original|una|first)( time)?|same time|as is)\b/i
/** "asaan", "wala sa calendar", "where is it": they can't find something Pal just added */
const WHERE_ASK = /\b(asan|asaan|nasaan|nasan|where('?s| is| did) (it|that)( go)?|wala sa (calendar|kalendaryo)|di ko (makita|nakita)|hindi ko (makita|nakita)|can'?t (see|find))\b/i

const isQuiet = (t: number) => {
  const h = new Date(t).getHours()
  return h >= QUIET[0] || h < QUIET[1]
}

export default function App() {
  const aiRequests = useRef(new AiRequestGate())
  const init = useMemo(load, [])
  const [settings, setSettings] = useState(init.settings)
  const [events, setEvents] = useState(init.events)
  const [tasks, setTasks] = useState(init.tasks)
  const [msgs, setMsgs] = useState(init.msgs)
  const [conversation, setConversation] = useState<ConversationFocus>(init.conversation ?? emptyFocus())
  const conversationRef = useRef(conversation)
  const saveConversation = (focus: ConversationFocus) => { conversationRef.current = focus; setConversation(focus) }
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
  const [heard, setHeard] = useState('')
  const heardTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [hf, setHf] = useState<{ state: HandsFreeState; progress?: number; error?: string; mic?: boolean; tap?: boolean }>({ state: 'off' })
  const [interim, setInterim] = useState('')
  const [idleLong, setIdleLong] = useState(false)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<string[]>([])
  const [pop, setPop] = useState<{ ev: CalEvent; rect: DOMRect } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>(init.loadWarning ? [{id:uid(),text:init.loadWarning}] : [])
  const previousTaskEvents = useRef(events)
  useEffect(()=>{const previousEvents=previousTaskEvents.current;previousTaskEvents.current=events;setTasks(previous=>{const next=previous.map(t=>reconcileTaskCalendar(t,events,previousEvents));return next.some((t,i)=>t!==previous[i])?next:previous})},[events])
  const titleConfirmation=useRef<{title:string;raw:string}|null>(null)
  const confirmedTitles=useRef(new Set<string>())
  const [travelDraft,setTravelDraft]=useState<TravelDraft|null>(null)
  const [scheduleEdit,setScheduleEdit]=useState<{event:CalEvent|null;isNew?:boolean}|null>(null)
  const createdAttachmentFolder=useRef<Folder|null>(null)
  const [attachmentFiles,setAttachmentFiles]=useState<File[]>([])
  const [taskEdit,setTaskEdit] = useState<{ task: Task | null } | null>(null)
  const [knowledgeFiles,setKnowledgeFiles]=useState<LibraryFile[]>([])
  const knowledgeRead=useRef(0)
  const [taskFolders,setTaskFolders] = useState<Folder[]>([])
  useEffect(()=>{let alive=true;const read=()=>{const generation=++knowledgeRead.current;void Promise.all([listFolders(),listFiles()]).then(([fs,files])=>{if(alive&&generation===knowledgeRead.current){setTaskFolders(fs);setKnowledgeFiles(files)}}).catch(()=>{})};read();window.addEventListener(LIBRARY_EVENT,read);return()=>{alive=false;window.removeEventListener(LIBRARY_EVENT,read)}},[])
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [activeModel, setActiveModel] = useState<string>(() => (hasCloudAi() ? PRIMARY_MODEL : 'Local Rules'))
  const [lastLatency, setLastLatency] = useState<number | null>(null)
  const [weather, setWeather] = useState<Weather | null>(getCachedWeather)
  const [lastIntent, setLastIntent] = useState<string>('')
  const { pipWindow, inAppFloating, openCompanion, closeCompanion } = useFloatingCompanion()
  // Your PC's AI takes ~40s to load the first time: start it now, not on the first message
  useEffect(() => preloadOllama(), [])
  useEffect(() => {
    if (!isPhoneAiPlatform()) return
    const setup = automaticModelSetup(() => phoneAi.prepare!(), () => !document.hidden)
    setup.start()
    document.addEventListener('visibilitychange', setup.start)
    return () => { setup.stop(); document.removeEventListener('visibilitychange', setup.start) }
  }, [])
  // Keep today's weather warm so offline questions still get an answer
  useEffect(() => {
    const go = () => { if (isPhoneAiPlatform() && getAiMode() === 'offline') return; void refreshWeather().then(w=>setWeather(acceptWeatherRefresh(w,getWeatherLocation()?.id))) }
    go()
    const changedLocation=()=>{setWeather(null);go()}
    const i = setInterval(go, 30 * MIN)
    window.addEventListener('online', go)
    window.addEventListener(WEATHER_EVENT,changedLocation)
    window.addEventListener(AI_MODE_EVENT, go)
    return () => { clearInterval(i); window.removeEventListener('online', go);window.removeEventListener(WEATHER_EVENT,changedLocation); window.removeEventListener(AI_MODE_EVENT, go) }
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

  /** The syllabus sheet: closed, empty for pasting, or filled from an attached file's text */
  const [syllabus, setSyllabus] = useState<false | { text?: string; source?: string }>(false)
  const [classScheduleFile, setClassScheduleFile] = useState<import('./lib/library').LibraryFile | null>(null)
  const [editing, setEditing] = useState(false)
  const [weekOff, setWeekOff] = useState(0)
  const [dayIdx, setDayIdx] = useState((new Date().getDay() + 6) % 7)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  const shellRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(false) // mobile drawer
  // Mobile: the pal + text box dock tucked into a small pal button, so the page underneath gets the whole screen.
  // Remembered; a dot on the button means Pal said something meanwhile.
  const [dockMin, setDockMinState] = useState(() => { try { return localStorage.getItem('paldo.dock') === 'min' } catch { return false } })
  const dockMinRef = useRef(dockMin)
  dockMinRef.current = dockMin
  const [unseen, setUnseen] = useState(false)
  const setDockMin = (v: boolean) => { setDockMinState(v); setUnseen(false); try { localStorage.setItem('paldo.dock', v ? 'min' : 'open') } catch {} }
  useEffect(() => { if (chatOpen) setUnseen(false) }, [chatOpen])
  const [clearing, setClearing] = useState(false)
  const [collapsed, setCollapsed] = useState(false) // desktop bubble
  useEffect(() => {
    if (!mobile || chatOpen || dockMin || !dockRef.current) return
    const dock = dockRef.current
    const update = () => shellRef.current?.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(update)
    observer.observe(dock)
    update()
    return () => observer.disconnect()
  }, [mobile, chatOpen, dockMin])
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#142843' : '#E5F0FF')
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
  const [focusSetup, setFocusSetup] = useState<StudyConfig | null>(null)
  const [session, setSession] = useState<Session>(() => { const saved = fromSaved(init.session); return countUp(saved) && !isPaused(saved) ? { ...saved, awayAt: saved.awayAt ?? saved.checkpointAt ?? saved.phaseStartedAt } : saved })
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
  /** Insights already raised this session, so a nudge is never repeated */
  const nudged = useRef(new Set<string>())
  /** Their last message was spoken (hands-free or the mic), so Pal's question gets a spoken answer too */
  const lastByVoice = useRef(false)
  const [focusLog, setFocusLog] = useState<Record<string, number>>(() => init.focusLog ?? {})
  // The pal's latest session line, shown on the Study screen (the chat bubble is hidden while the chat log is open)
  const [studyLine, setStudyLine] = useState('')
  const sessionRef = useRef(session)
  sessionRef.current = session
  const todayFocus = focusLog[new Date().toDateString()] ?? 0
  const logFocus = (ms: number, end = Date.now()) => {
    if (ms <= 0) return
    const additions: Record<string, number> = {}
    let cursor = end - ms
    while (cursor < end) {
      const day = new Date(cursor), boundary = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
      const until = Math.min(end, boundary)
      additions[day.toDateString()] = (additions[day.toDateString()] ?? 0) + (until - cursor) / 60_000
      cursor = until
    }
    setFocusLog(l => { const next = { ...l }; for (const [day, minutes] of Object.entries(additions)) next[day] = (next[day] ?? 0) + minutes; return next })
  }
  // The view as of now, for callbacks created in older renders (the reconcile interval)
  const viewRef = useRef(view)
  viewRef.current = view
  // Alarms are armed ahead of time, so each text names the phase that is ending
  const alarmBody = (e: { phase: 'focus' | 'break'; round: number }) =>
    e.phase === 'focus'
      ? e.round === LONG_EVERY ? 'Four rounds done! Time for a longer break.' : 'Round done! Time for a break.'
      : e.round === LONG_EVERY ? "Set complete! Start another whenever you're ready." : "Break's over. Start the next round when you are ready."
  /** One native alarm per phase end left in the set. Only user actions re-arm; natural transitions are already armed. */
  const armSession = (s: Session) =>
    scheduleSessionAlarms(phaseEnds(s, Date.now()).map((e) => ({ at: e.at, title: PALS[palRef.current].name, body: alarmBody(e) })))
  /** Explicit opt-in (reminders card or Study hint): the only path allowed to show OS permission screens. */
  const turnOnAlarms = () =>
    enableAlarms().then((granted) => {
      setSettings((s) => ({ ...s, notify: granted }))
      if (!granted) return false
      syncEventAlarms(ev.current, name)
      const s = sessionRef.current
      if (running(s)) armSession(s)
      return true
    })

  /** The one place a session changes: logs focus and lets the pal react to a new phase (or a finished set). */
  function applySession(next: Session, prev: Session, natural = false) {
    // Update the ref now, not on next render: a second check() before re-render must not re-apply the same transition
    sessionRef.current = next
    if (next.version && next.focusDays) { setFocusLog(l => { const out = { ...l }; for (const [day, ms] of Object.entries(next.focusDays!)) { const delta = ms - (prev.focusDays?.[day] ?? 0); if (delta > 0) out[day] = (out[day] ?? 0) + delta / 60_000 } return out }) } else logFocus(next.completedFocusMs - prev.completedFocusMs)
    const changed = next.phase !== prev.phase || next.round !== prev.round
    // Moving to idle on its own means the set finished; the user's Stop goes through studyStop instead
    if (changed && (next.phase !== 'idle' || natural)) {
      const key = next.phase === 'idle' || next.phase === 'finished' ? 'setDone' : next.phase === 'focus' ? 'focusStart' : phaseLabel(next) === 'Long break' ? 'longBreak' : 'breakStart'
      const line = next.phase === 'waiting' ? 'Break finished. Start the next round when you are ready.' : next.phase === 'breakReady' ? 'Choose a break that feels right.' : next.phase === 'focus' && next.version ? (palRef.current === 'jhyvie' ? 'Nagsimula na ang oras mo sa pag-aaral.' : countUp(next) ? 'Your focus clock is counting up. Finish when you are ready.' : `Your ${next.config?.method === 'pomodoro' ? 25 : next.config?.method === '52-17' ? 52 : next.config?.focusMinutes} minute focus session has started.`) : say(palRef.current, key)
      if (natural) {
        if (document.hidden) notifyWeb(PALS[palRef.current].name, line)
        if (!isQuiet(Date.now())) next.phase === 'focus' ? playSound('focus') : next.phase === 'break' ? playSound('break') : playChime()
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
    const current = sessionRef.current
    if (active(current)) return
    const s = start(Date.now(), current.config ?? DEFAULT_CONFIG)
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
  const studyStop = (done = false) => {
    const prev = sessionRef.current
    const next = finish(prev, Date.now(), done)
    cancelSessionAlarms()
    applySession(next, prev)
    setStudyLine('Focused time saved. Take a moment before your next session.')
  }
  const studyConfigure = (config: StudyConfig) => { if (!validateConfig(config)) { toast({ text: 'Check the timer duration and task description. Your current session was kept.' }); return } const next = configure(config); sessionRef.current = next; setSession(next); setStudyLine('') }
  const studyNext = (minutes?: number) => { unlockChime(); const prev = sessionRef.current; const next = nextRound(prev, Date.now(), minutes); applySession(next, prev); armSession(next) }
  const studyRecover = (include: boolean) => { const prev = sessionRef.current; applySession(recoverAway(prev, Date.now(), include), prev) }
  useEffect(() => {
    const markAway = () => {
      const prev = sessionRef.current
      if (!countUp(prev) || isPaused(prev) || prev.awayAt !== undefined) return
      const next = checkpoint(prev, Date.now())
      sessionRef.current = next; setSession(next)
      try { const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); localStorage.setItem(KEY, JSON.stringify({ ...saved, session: next })) } catch {}
    }
    const visibility = () => { if (document.hidden) markAway() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', markAway)
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', markAway) }
  }, [])
  // Catch up from timestamps every second while running, and right away when the tab becomes visible again
  const sessionRunning = running(session)
  useEffect(() => {
    if (!sessionRunning) return
    const check = () => {
      const prev = sessionRef.current
      const next = tick(prev, Date.now())
      if (next !== prev) applySession(next, prev, true)
      else if (countUp(prev) && Date.now() - (prev.checkpointAt ?? 0) >= 5000) { const next = recoverAway(checkpoint(prev, Date.now()), Date.now(), false); sessionRef.current = next; setSession(next) }
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
    localStorage.setItem(KEY, JSON.stringify({ settings, events, tasks, msgs: msgs.slice(-80), asked, alerted, log, offset, session, focusLog, alarms, conversation } satisfies Saved))
  }, [settings, events, tasks, msgs, asked, alerted, log, offset, session, focusLog, alarms, conversation])
  useEffect(() => {
    const i = setInterval(() => setClock(Date.now()), 20_000)
    const mq = window.matchMedia('(max-width: 1023px)')
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

  const palState: PalState = micOn || typing || hf.state === 'awake' || hf.state === 'thinking' ? 'listening' : mood ? mood.state : isQuiet(now) || idleLong ? 'sleeping' : 'idle'
  const feel = (state: PalState, ms = 1600) => setMood({ state, until: Date.now() + ms })

  /* ---------- voice ---------- */
  const voiceOnRef = useRef(settings.voiceOn)
  const speechSequence = useRef(0)
  const englishSpeechRef = useRef(false)
  const speak = useCallback((text: string, force = false, ack = false) => {
    if ((!voiceOnRef.current && !force) || !text) return
    const id = ++speechSequence.current
    void speakPal(text, pal, () => { if (!ack && id === speechSequence.current) { setPalSpeaking(true, text); feel('talking', 60_000) } }, englishSpeechRef.current).then(ok => {
      if (id !== speechSequence.current) return
      setMood(m => m?.state === 'talking' ? null : m)
      setPalSpeaking(false)
      if (!ok) toast({ text: 'Voice unavailable. Your reply is still here.' })
      if (!ack && ok !== 'cancelled' && followNext.current) {
        followNext.current = false
        expectFollowUp(8_000)
        void liveAfterWakeRef.current('')
      }
    })
  }, [pal])
  useEffect(() => { speechSequence.current++; stopSpeech(); setPalSpeaking(false); return () => { speechSequence.current++; stopSpeech() } }, [pal])
  // Hands-free callbacks are made once per start; this keeps them on the current voice and pal
  const speakRef = useRef(speak)
  speakRef.current = speak

  const recRef = useRef<any>(null)
  // The Android app's WebView has webkitSpeechRecognition but no speech service behind it: it starts and hears
  // nothing. There, the on-device path (voice detector + Whisper) takes every request
  const SR = typeof window !== 'undefined' && !isNative ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null

  /* ---------- messaging helpers ---------- */
  const toast = (t: Omit<Toast, 'id'>) => setToasts((x) => [...x.slice(-2), { id: uid(), ...t }])
  const dismiss = useCallback((id: string) => setToasts((x) => x.filter((t) => t.id !== id)), [])
  const palSay = (text: string, extra: Partial<Msg> = {}, state: PalState = 'talking') => {
    setBubble({ id: uid(), mascotId: palRef.current, text, kind: 'response' })
    if (dockMinRef.current) setUnseen(true)
    if (!voiceOnRef.current && !document.hidden) playSound('receive')
    // Always record pal replies in the chat history feed, avoiding immediate duplicates
    setMsgs((m) => {
      const last = m[m.length - 1]
      if (last && last.from === 'pal' && last.text === text && !extra.card) {
        return m
      }
      return [...m, { id: uid(), from: 'pal', text, ...extra }]
    })
    feel(state, state === 'talking' ? Math.min(2600, 500 + text.length * 28) : 1800)
    // Hands-free: keep conversation flowing after every spoken response
    // (unless this was an explicit goodbye/dismissal)
    if (isHandsFreeOn() && lastByVoice.current && !extra.dismissal) {
      followNext.current = true
      if (!voiceOnRef.current) {
        followNext.current = false
        expectFollowUp(8_000)
        void liveAfterWakeRef.current('')
      }
    }
    speak(text)
    // A card needs a tap, and on phones the collapsed drawer hides cards: open it so the button is in reach
    if (mobile && (extra.card?.type === 'event' || extra.card?.type === 'readback' || extra.card?.type === 'change')) setChatOpen(true)
  }

  /* ---------- hands-free "Hi {pal}" ---------- */
  const hfPrev = useRef<HandsFreeState>('off')
  function announceWakeReady() {
    playMicSound(true)
    setBubble({ id: uid(), mascotId: palRef.current, text: 'Listening…', kind: 'response' })
  }
  /** When they last talked to Pal hands-free (or turned it on), so quiet hours never cut off someone who's awake */
  const lastVoice = useRef(0)
  const hfOptions = (oneShot = false) => ({
    pal,
    userName: settings.userName,
    deviceOnly: !!settings.sttDeviceOnly,
    oneShot,
    // Only what's said after "Hi {pal}" ever goes to the cloud; the hint helps it spell names and Taglish
    transcribeCloud: (wav: Blob) => transcribeGroq(wav, `${PALS[pal].name}, timer, reminder, bukas, mamaya, Taglish`),
    onState: (state: HandsFreeState, info?: { progress?: number; error?: string; mic?: boolean; tap?: boolean }) => {
      const prev = hfPrev.current
      hfPrev.current = state
      setHf({ state, ...info })
      if (oneShot && (state === 'off' || state === 'error')) setMicOn(false)
      // The mic stopped listening to you (request taken, or the window closed): the soft closing sound
      if (prev === 'awake' && (state === 'listening' || state === 'thinking')) playMicSound(false)
      // "Say Hi Rei" the first time it's ever ready; after that it just quietly listens on every load
      if (!oneShot && prev === 'loading' && state === 'listening' && !localStorage.getItem('paldo.hfIntro')) {
        try { localStorage.setItem('paldo.hfIntro', '1') } catch {}
        // A tip in the speech bubble, not a chat message: it isn't part of the conversation
        setBubble({ id: uid(), mascotId: palRef.current, text: say(palRef.current, 'hfOn', { name: PALS[palRef.current].name }), kind: 'response' })
      }
      if (state === 'error') palSay(say(palRef.current, info?.error === 'mic-blocked' ? 'hfMicBlocked' : 'hfError'))
    },
    // Finish the wake clip before opening command capture; its audio never becomes a message.
    onWake: (phase: 'early' | 'late' | 'full') => {
      lastVoice.current = Date.now()
      clearTimeout(heardTimer.current)
      setHeard('')
      setInterim('')
      if (phase === 'early') {
        playMicSound(true)
        feel('listening', 8000)
        setBubble({ id: uid(), mascotId: palRef.current, text: 'Listening… go ahead', kind: 'response' })
        return
      }
      if (phase === 'late') { announceWakeReady(); return }
      void liveAfterWakeRef.current('').then(started => {
        if (!started && isHandsFreeOn()) announceWakeReady()
      })
    },
    onPreview: (text: string) => {
      clearTimeout(heardTimer.current)
      setHeard(stripWakePhrase(text, palRef.current, settings.userName))
    },
    onCommand: (text: string) => {
      lastVoice.current = Date.now()
      // On-device path: no live words while talking, so show what it heard under the mic for a moment
      setHeard(text)
      clearTimeout(heardTimer.current)
      heardTimer.current = setTimeout(() => setHeard(''), 4000)
      sendRef.current(text, true)
    },
    // "Hey Jhyvie" while Rei listens: Rei says who it is, then handles the request (or waits for it)
    onWrongName: (wrong: string, command: string) => {
      lastVoice.current = Date.now()
      palSay(say(palRef.current, 'wrongPal', { wrong, me: PALS[palRef.current].name }))
      if (command) sendRef.current(command, true)
    },
    // "Hi Jhyvie" over Pal's own voice: stop talking and listen
    onBargeIn: () => {
      lastVoice.current = Date.now()
      followNext.current = false
      window.speechSynthesis?.cancel()
      stopKokoro(); stopNative()
    },
  })
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
        lastVoice.current = Date.now()
        setSettings((s) => ({ ...s, handsFree: true, voiceOn: true }))
        return startHandsFree({ ...hfOptions(), noMic: true })
      }
      w.__palHear = (text: string) => import('./lib/handsfree').then((m) => m.simulateHeard(text))
      w.__palVoiceTest = (o?: Parameters<typeof import('./lib/voice.selftest').runVoiceSelfTest>[0]) => import('./lib/voice.selftest').then((m) => m.runVoiceSelfTest(o))
      w.__palWakeTest = (o: Parameters<typeof import('./lib/wakeword.selftest').runWakeTest>[0]) => import('./lib/wakeword.selftest').then((m) => m.runWakeTest(o))
    }
  })
  // Hands-free is always on once onboarding is done: it starts by itself on load (the mic was allowed in onboarding).
  // A browser may hold the audio until the first tap, so that tap also lets it run; if it's off, the tap starts it
  useEffect(() => {
    if (!settings.onboarded) return
    if (hf.state === 'off') {
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
      void perms?.query({ name: 'microphone' as PermissionName }).then((p) => { if (p.state === 'granted' && !isHandsFreeOn()) startHandsFree(hfOptions()) }).catch(() => {})
    }
    const tap = () => {
      unlockChime()
      void resumeAudio()
      if (!isHandsFreeOn()) startHandsFree(hfOptions())
    }
    window.addEventListener('pointerdown', tap, { once: true })
    return () => window.removeEventListener('pointerdown', tap)
  }, [settings.onboarded, hf.state]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (al.kind === 'done') {
      setRinging(al.timer.id)
      // Hands-free: "stop" / "okay" turns it off without "Hi Jhyvie" first
      if (isHandsFreeOn()) expectFollowUp(60_000)
    }
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
    const up = ev.current.filter((e) => e.status === 'planned' && e.kind !== 'deadline' && (e.kind !== 'commute' || e.transportSource === 'user-trip') && e.end > n).sort((a, b) => a.start - b.start)
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
        if (s.phase === 'waiting') studyNext()
        else if (!active(s)) studyStart()
        else if (isPaused(s)) studyResume()
        return palSay(pal === 'jhyvie' ? 'Handa na ang sesyon mo sa pag-aaral.' : 'Your focus session is ready.', {}, 'happy')
      }
      if (!active(s)) return palSay(say(pal, 'noStudy'))
      if (c.op === 'left' && countUp(s)) return palSay(`You have focused for ${fmtLeft(focusElapsed(s, now))}.`)
      if (c.op === 'left') return palSay(say(pal, 'studyLeft', { phase: phaseLabel(s), left: fmtLeft(remaining(s, now)) }))
      if (c.op === 'pause') studyPause()
      else if (c.op === 'resume') studyResume()
      else if (c.op === 'skip') studySkip()
      else studyStop()
      return palSay(say(pal, c.op === 'stop' ? 'sessionDone' : c.op === 'skip' ? 'studySkipped' : c.op === 'pause' ? 'studyPaused' : 'focusStart', { m: todayFocus }))
    }
    if (c.type === 'whoami') {
      const user = settings.userName?.trim()
      return palSay(user ? say(pal, 'whoami', { user }) : say(pal, 'whoamiNone'), {}, user ? 'happy' : 'talking')
    }
    palSay(nextLine())
  }

  // Daily brief on the first open of the day, built only from app-computed facts
  useEffect(() => {
    if (!settings.onboarded || isQuiet(Date.now())) return
    const today = new Date().toDateString()
    if (settings.lastBrief === today) return
    let cancelled = false
    const mode = getAiMode()
    const id = setTimeout(async () => {
      const offline = isPhoneAiPlatform() && mode === 'offline'
      const w = offline ? getCachedWeather() : (await Promise.race([refreshWeather(), new Promise<null>((r) => setTimeout(() => r(null), 4000))])) ?? getCachedWeather()
      if (cancelled || document.hidden || (isPhoneAiPlatform() && getAiMode() !== mode)) return
      if (w) setWeather(w)
      const s = buildContext(Date.now(), ev.current, tk.current, w, settings.prefs, { user: settings.userName })
      const h = new Date().getHours()
      palSay([
        `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${settings.userName?.trim() ? `, ${settings.userName.trim()}` : ''}!`,
        s.today === 'nothing else' ? 'Nothing else planned today.' : `Still today: ${s.today}.`,
        s.weather ? `Weather: ${s.weather}.` : '',
        s.insight,
        (() => { const i = dayInsights(Date.now(), ev.current, tk.current, Date.now(), settings.prefs)[0]; return i ? (pal === 'jhyvie' ? i.textTl : i.text) : '' })(),
      ].filter(Boolean).join(' '))
      setSettings((x) => ({ ...x, lastBrief: today }))
    }, 1500)
    return () => { cancelled = true; clearTimeout(id) }
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
  function offer(task: Task, hours: number, base: CalEvent[], lead: string, opts: { replaces?: string[]; perDay?: number; notBefore?: number; preserveTotal?: boolean } = {}) {
    if (task.due == null) return palSay('Choose a deadline before planning study time.')
    const due = task.due
    const replaced = new Set(opts.replaces ?? [])
    const p = propose(task, hours, base.filter((e) => !replaced.has(e.id)), Math.max(nowRef.current, opts.notBefore ?? nowRef.current), settings.energy, settings.prefs, opts.perDay)
    const next = [...base, ...p.blocks]
    setEvents(next)
    const commute = task.kind === 'exam' && base.some((e) => e.kind === 'commute' && e.start > nowRef.current && e.start < due && !e.note)
    const card: Card = { type: 'proposal', taskId: task.id, blockIds: p.blocks.map((b) => b.id), why: p.why, shortfall: p.shortfall, freeHours: p.freeHours, commute, replaces: opts.replaces?.length ? opts.replaces : undefined, taskUpdate: { due, hours: opts.preserveTotal ? task.hours : task.doneHours + hours } }
    // An older plan for the same task is stale now: say so, instead of an empty card
    setMsgs((ms) => ms.map((m) => (m.card?.type === 'proposal' && m.card.taskId === task.id && !m.resolved ? { ...m, resolved: 'Replaced by a newer plan' } : m)))
    const times = p.blocks.map((b) => `${fmtDay(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)}`).join(', ')
    palSay(times ? `${say(pal, 'proposal')} ${times}.${p.shortfall > 0 ? ` ${fmtHours(p.shortfall)} still needs a slot.` : ''}` : 'No suitable study slots fit before this deadline. Which constraint can we adjust?', { card }, p.shortfall > 0 ? 'alarmed' : 'talking')
    if (p.blocks[0]) {
      showWeekOf(p.blocks[0].start)
      flash(p.blocks.map((b) => b.id))
    }
  }

  function createTask(d: Draft, lead = say(pal, 'proposal'), perDay?: number, notBefore?: number) {
    if (!d.due || !d.hours) return
    const hasTime = new Date(d.due).getHours() !== 23
    const task: Task = { id: uid(), title: d.title, kind: d.kind, due: d.due, hours: d.hours, doneHours: 0 }
    const marker: CalEvent =
      d.kind === 'exam' && hasTime
        ? { id: uid(), title: d.title, kind: 'exam', start: d.due, end: d.due + 1.5 * HOUR, status: 'planned', taskId: task.id }
        : { id: uid(), title: d.title, kind: 'deadline', start: d.due, end: d.due, status: 'planned', taskId: task.id }
    setTasks((t) => [...t, task])
    offer(task, d.hours, [...ev.current, marker], lead, { perDay, notBefore })
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
    offer({ ...task, doneHours }, left, kept, opts.lead ?? say(pal, 'reflow', { h: fmtHours(left) }), { replaces: opts.replaces, preserveTotal: true })
  }

  /** "Prelims review" plans toward the Prelims task already set up, instead of a duplicate task */
  function saveManualTask(draft: TaskDraft, allowOverlap = false) {
    const original = taskEdit?.task ?? null
    const latest = original ? tk.current.find(t=>t.id===original.id) : undefined
    if(original && (!latest || JSON.stringify(latest)!==JSON.stringify(original))) throw new Error('This task changed while you were editing. Reopen it to keep those changes.')
    const task = latest ? applyTaskEdit(latest,draft,Date.now()) : newTask(draft,Date.now())
    if(task.status==='doing' && tk.current.filter(t=>t.id!==task.id&&t.status==='doing').length>=3) throw new Error('Your Workbench already has three tasks.')
    if(task.scheduled && !allowOverlap) {
      const slot=task.scheduled
      const hits=ev.current.filter(e=>e.id!==slot.eventId && e.kind!=='deadline' && ['planned','proposed'].includes(e.status) && e.start<slot.end && e.end>slot.start)
      if(hits.length){const error=new Error(`This time overlaps ${hits.map(e=>e.title).join(', ')}.`);error.name='ScheduleConflict';throw error}
    }
    const nextEvents=syncTaskCalendar(original,task,ev.current)
    const nextTasks=latest?tk.current.map(t=>t.id===task.id?task:t):[...tk.current,task]
    tk.current=nextTasks;ev.current=nextEvents;setTasks(nextTasks);setEvents(nextEvents);setTaskEdit(null)
    toast({text:original?'Task saved':'Task added'})
  }
  function saveManualSchedule(draft:ScheduleDraft,allowOverlap:boolean){
    if(!scheduleEdit)return
    const candidate=scheduleEdit.event
    const original=resolveEditorOriginal(scheduleEdit,ev.current)
    const result=applyScheduleEdit(original,{...draft,travel:draft.travel??candidate?.travel},ev.current,allowOverlap)
    const coordinated=synchronizeScheduleOwner(original,result.event,tk.current,ev.current,Date.now())
    tk.current=coordinated.tasks;ev.current=coordinated.events;setTasks(coordinated.tasks);setEvents(coordinated.events);setScheduleEdit(null);toast({text:original?'Schedule saved':'Schedule added'})
  }
  function moveManualTask(id: string, status: NonNullable<Task['status']>) {
    const task=tk.current.find(t=>t.id===id)
    if(!task)return
    const result=transitionTask(task,status,tk.current,Date.now())
    if(result.error)return toast({text:result.error})
    try{
      const nextEvents=syncTaskCalendar(task,result.task!,ev.current)
      const nextTasks=tk.current.map(t=>t.id===id?result.task!:t)
      tk.current=nextTasks;ev.current=nextEvents;setTasks(nextTasks);setEvents(nextEvents)
    }catch(e){toast({text:(e as Error).message})}
  }

  function matchTask(title: string) {
    const norm = (s: string) => s.toLowerCase().replace(/\b(review|study|studying|aral|for|sa|ng|para|session)\b/g, ' ').replace(/\s+/g, ' ').trim()
    const n = norm(title)
    if (n.length < 3) return undefined
    return datedTasks(tk.current).find((t) => {
      const m = norm(t.title)
      return t.due > nowRef.current && m.length >= 3 && (n.includes(m) || m.includes(n))
    })
  }

  /** The model asked for study time ("find 3h before Friday", "2h every day until the 17th"). The app picks the slots. */
  function findTime(g: AiAction, lead: string, opts: { replace?: boolean; notBefore?: number } = {}) {
    const now = nowRef.current
    const existing = matchTask(g.title ?? '')
    const resolved = resolveStudyRequest({ intent: 'study', title: g.title, rejected: [], due: parseIsoToLocalMs(g.due) ?? undefined }, ev.current, tk.current, now)
    const due = resolved?.due ?? parseIsoToLocalMs(g.due) ?? existing?.due
    if (!due || due <= now) return palSay(say(pal, 'studyWhich'))
    const perDay = g.perDay && g.perDay > 0 ? Math.min(g.perDay, 8) : undefined
    const earliest = Math.max(now, opts.notBefore ?? now)
    // Days with room to study before the due time; today only if a full day's share still fits before 11pm
    let days = 0
    for (let d = startOfDay(earliest); at(d, 7) < due; d = addDays(d, 1)) if (d !== startOfDay(earliest) || at(d, 23) - earliest >= (perDay ?? 0) * HOUR) days++
    const hours = perDay ? perDay * Math.max(1, days) : g.hours || 2
    if (existing) {
      const base = ev.current.filter((e) => !(e.taskId === existing.id && e.status === 'proposed'))
      const replaces = opts.replace ? base.filter((e) => e.taskId === existing.id && e.kind === 'work' && e.status === 'planned' && e.start > now).map((e) => e.id) : undefined
      return offer({ ...existing, due }, perDay ? hours : g.hours || Math.max(0.5, existing.hours - existing.doneHours), base, lead, { perDay, replaces, notBefore: opts.notBefore })
    }
    if (resolved?.exam) {
      const task: Task = { id: uid(), title: resolved.exam.title, kind: 'exam', due, hours, doneHours: 0 }
      setTasks((tasks) => [...tasks, task])
      return offer(task, hours, ev.current, lead, { perDay, notBefore: opts.notBefore })
    }
    createTask({ title: g.title?.trim() || 'Study', kind: 'assignment', due, hours }, lead, perDay, opts.notBefore)
  }

  /* ---------- Study library ---------- */
  const [studySection, setStudySectionState] = useState<'focus' | 'library'>(() => { try { return localStorage.getItem('paldo.study') === 'focus' ? 'focus' : 'library' } catch { return 'library' } })
  const setStudySection = (s: 'focus' | 'library') => { setStudySectionState(s); try { localStorage.setItem('paldo.study', s) } catch {} }
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null)
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget | null>(null)
  function openInLibrary(t: LibraryTarget) {
    setStudySection('library')
    setLibraryTarget(t)
    setView('study')
    if (mobile) setChatOpen(false)
  }

  /** "Plan study" on a reviewer: its length sets the hours, its subject's exam the deadline (asked for if there's none) */
  function planFromFile(file: LibraryFile, folder: Folder) {
    setCollapsed(false)
    if (mobile) setChatOpen(true)
    const hours = studyHours(file.pages)
    const title = titleFromFileName(file.name)
    const subject = new Set(terms(folder.name))
    const task = datedTasks(tk.current).filter((t) => t.due > nowRef.current && terms(t.title).some((w) => subject.has(w))).sort((a, b) => a.due - b.due)[0]
    const topics = topicsOf(file.chunks, 4)
    if (task) {
      palSay(say(pal, 'planFromFile', { file: title, h: fmtHours(hours), topics: topics.length ? ` It covers ${topics.join(', ')}.` : '' }))
      return findTime({ type: 'findTime', title: task.title, hours, due: toLocalIso(task.due) }, '')
    }
    // No exam on the calendar for this subject yet: the usual "when's it due?" question, with the hours filled in.
    // Whatever event the chat was on before is done, so "friday 9am" answers this, not that.
    saveConversation(emptyFocus())
    setDraft({ title: `${folder.name} exam`, kind: 'exam', hours })
    setAwaiting('due')
    palSay(say(pal, 'planNeedsDate', { file: title, h: fmtHours(hours), what: `${folder.name} exam` }))
  }

  function attachFile(files: File[]) { createdAttachmentFolder.current=null;setAttachmentFiles(files) }
  async function placeAttachments(destination:AttachmentDestination) {
    const folders=await listFolders()
    let folder:Folder|undefined
    if(destination.kind==='folder'){folder=folders.find(f=>f.id===destination.folderId);if(!folder)throw new Error('This folder is no longer available.')}
    if(destination.kind==='new-folder'){folder=createdAttachmentFolder.current??newFolder(destination.name,folders);if(!createdAttachmentFolder.current){await saveFolder(folder);createdAttachmentFolder.current=folder}}
    const selected=[...attachmentFiles]
    const failures:File[]=[]
    for(const file of selected){
      try{
        const r=await importFile(file,folder?.id??null)
        if(typeof r==='string'){failures.push(file);toast({text:`${file.name}: ${r==='too-big'?'over 25 MB':r==='unsupported'?'unsupported file type':'could not read this file'}.`});continue}
        setMsgs(m=>[...m,{id:uid(),from:'me',text:`📎 ${file.name}`}])
        const dates=r.scanned?0:scanDeadlines(r.chunks.map(c=>c.text).join('\n'),nowRef.current).length
        palSay(folder?say(pal,r.scanned?'fileScanned':dates>=2?'fileHasDates':'fileSaved',{file:titleFromFileName(file.name),folder:folder.name,n:String(dates)}):`Kept ${file.name} in chat. You can move it to a folder later.`,{card:{type:'file',fileId:r.id,name:titleFromFileName(r.name),folderName:folder?.name??'Chat attachment',scanned:r.scanned,dates}},'happy')
      }catch{failures.push(file);toast({text:`Could not save ${file.name}. Try again.`})}
    }
    setAttachmentFiles(failures)
    if(failures.length)throw new Error('Some files could not be saved. Successful files are saved; retry only the remaining files.')
  }

  /** "Quiz me on osmosis", "flashcards for bio", "read my reviewer aloud": the file that best matches, opened in that mode */
  async function openStudyAid(mode: LibraryMode, topic: string) {
    const files = (await listFiles()).filter((f) => !f.scanned)
    if (!files.length) return palSay(say(pal, 'noFilesYet'))
    const folders = await listFolders()
    const want = new Set(terms(topic))
    const score = (f: LibraryFile) => {
      const name = terms(`${f.name} ${folders.find((x) => x.id === f.folderId)?.name ?? ''}`)
      const body = terms(f.chunks.map((c) => `${c.heading ?? ''} ${c.text}`).join(' '))
      return name.filter((w) => want.has(w)).length * 5 + body.filter((w) => want.has(w)).length
    }
    // No topic ("quiz me" right after attaching): the newest file, the one they're talking about
    const best = want.size ? [...files].sort((a, b) => score(b) - score(a) || b.addedAt - a.addedAt)[0] : [...files].sort((a, b) => b.addedAt - a.addedAt)[0]
    palSay(say(pal, mode === 'cards' ? 'openCards' : mode === 'quiz' ? 'openQuiz' : 'openRead', { file: titleFromFileName(best.name) }))
    // A topic that's just the subject ("quiz me on bio") means the whole file
    const subjectOnly = !!topic && terms(topic).every((w) => terms(best.name).includes(w) || terms(folders.find((x) => x.id === best.folderId)?.name ?? '').includes(w))
    openInLibrary({ fileId: best.id, mode, topic: subjectOnly ? undefined : topic || undefined })
  }

  /* ---------- chat input ---------- */
  function planTask(t: Task) {
    setCollapsed(false)
    if (mobile) setChatOpen(true)
    reflow(t.id, ev.current)
  }

  /** Show one event as a confirm card (Add it / Never mind). Older unanswered event cards are marked replaced. */
  function previewEvent(text: string, e: { title: string; kind: string; start: number; end: number; days?: number[]; until?: number }) {
    const weatherAdvice=outdoorWeatherAdvice(e.title,weather,ev.current,e.start,e.end,nowRef.current)
    if(weatherAdvice)text+=` ${weatherAdvice}`
    saveConversation({ intent: 'event', title: e.title, kind: e.kind as ConversationFocus['kind'], day: startOfDay(e.start), start: e.start, end: e.end, rejected: [] })
    const slots = e.days?.length ? occurrences(e.start, e.end, e.days, nowRef.current, e.until) : [{ start: e.start, end: e.end }]
    // A task's study blocks under it get new times on add; anything else it overlaps is a clash Pal asks about
    const under = ev.current.filter((x) => x.kind === 'work' && x.taskId && (x.status === 'planned' || x.status === 'proposed') && slots.some((s) => x.start < s.end && x.end > s.start))
    const conflicts = under.length
    const blocked = under.length ? under.slice(0, 3).map((x) => `${x.title}, ${fmtTime(x.start)}–${fmtTime(x.end)}`) : undefined
    const hit = clashes(slots, ev.current)
    const first = slots[0] ?? { start: e.start, end: e.end }
    const alt = hit.length && e.kind !== 'exam' ? nearestFree(slots, ev.current, nowRef.current) ?? undefined : undefined
    const clash = hit.length ? [...new Map(hit.map((x) => [x.title, `${x.title}, ${fmtTime(x.start)}–${fmtTime(x.end)}`])).values()].slice(0, 2) : undefined
    // A secretary's call: a bus ride or a gym session gives way to a dinner; a class, shift or exam never moves
    const aside = slots.length === 1 ? resolveClash(first, e.kind, hit, ev.current, nowRef.current) : null
    const moveOther = aside ? { id: aside.event.id, title: aside.event.title, to: aside.to, trimmed: aside.trimmed } : undefined
    const move = aside && e.kind === 'exam' ? say(pal, 'moveOther', { other: aside.event.title, to: `${fmtTime(aside.to.start)}–${fmtTime(aside.to.end)}` }) : ''
    setMsgs((ms) => ms.map((m) => (m.card?.type === 'event' && !m.resolved ? { ...m, resolved: 'Changed' } : m)))
    // A clash is the app's line, never the model's ("free ka pa!" over a 4–5am commute).
    // Hands-free: they may not be looking, so the card is asked out loud as a yes/no question.
    const line = clash
      ? e.kind === 'exam' ? say(pal, 'examOverlap', { range: `${fmtTime(first.start)}–${fmtTime(first.end)}`, clash: clash.join(' and '), move })
        // "Let's keep the dinner and move your bus home to 9:15pm. Okay?" (a plain yes does exactly that)
        : aside ? say(pal, aside.trimmed ? 'keepAndTrim' : 'keepAndMove', { what: e.title, other: aside.event.title, to: `${fmtTime(aside.to.start)}–${fmtTime(aside.to.end)}` })
        : say(pal, alt ? 'overlapAsk' : 'overlapAskNoAlt', { clash: clash.join(' and '), alt: alt ? `${fmtTime(alt.start)}–${fmtTime(alt.end)}` : '' })
      : isHandsFreeOn() ? say(pal, 'voiceAddAsk', { what: `${e.title}, ${fmtDay(first.start).replace(/,.*/, '')} ${fmtTime(first.start)}` }) : text
    palSay(line, { card: { type: 'event', title: e.title, kind: e.kind, start: first.start, end: first.end, conflicts, blocked, whatIf: true, days: e.days, until: e.until, clash, alt, moveOther } }, conflicts || clash ? 'alarmed' : 'talking')
    showWeekOf(first.start)
  }

  /** Remove or move something already on the calendar: a card first, nothing changes until the user says yes */
  function previewChange(text: string, mode: 'remove' | 'move', e: CalEvent, to?: { start: number; end: number }, targets?: CalEvent[]) {
    setMsgs((ms) => ms.map((m) => m.card?.type === 'change' && !m.resolved ? { ...m, resolved: 'Superseded by a newer selection' } : m))
    // The same slot on other days (a class, a daily session), so "remove all" is one tap
    const tod = (t: number) => t - startOfDay(t)
    const series = mode === 'remove'
      ? [...new Set([e.id, ...ev.current.filter((x) => x.title === e.title && x.kind === e.kind && x.status === 'planned' && x.start >= nowRef.current && tod(x.start) === tod(e.start)).map((x) => x.id)])]
      : []
    const what = `${e.title}, ${fmtDay(e.start).replace(/,.*/, '')} ${fmtTime(e.start)}`
    const line = isHandsFreeOn() ? say(pal, mode === 'remove' ? 'voiceRemoveAsk' : 'voiceMoveAsk', { what }) : text
    const hit = to ? clashes([to], ev.current, e.id) : []
    const clash = hit.length ? hit.slice(0, 2).map((x) => `${x.title}, ${fmtTime(x.start)}–${fmtTime(x.end)}`) : undefined
    palSay(targets ? `Remove these ${targets.length} review blocks? The actual exam stays on your calendar.` : line, { card: { type: 'change', mode, eventId: e.id, title: e.title, kind: e.kind, start: e.start, end: e.end, to, targets: targets?.map((target) => ({ id: target.id, title: target.title, start: target.start, end: target.end })), seriesIds: targets ? undefined : series.length > 1 ? series : undefined, clash } }, clash ? 'alarmed' : 'talking')
    showWeekOf(to?.start ?? e.start)
    flash([e.id])
  }

  /** The event this chat most recently added: what "delete mo yan" points at */
  function lastAddedEvent(ms: Msg[]) {
    const c = [...ms].reverse().find((m) => m.card?.type === 'event' && m.resolved?.startsWith('Added'))?.card
    return c?.type === 'event' ? ev.current.find((x) => x.title === c.title && (x.start === c.start || x.start === c.alt?.start)) : undefined
  }

  /** What a past Pal line did, in the model's own action shape, so it remembers what it proposed */
  function cardAction(m: Msg): AiAction {
    const c = m.card
    if (!c) return { type: m.rule?.includes('redirected') ? 'redirect' : 'none' }
    // Just enough to remember what it offered: every field here is paid for on every message
    if (c.type === 'event') return { type: 'addEvent', title: c.title, kind: c.kind as AiAction['kind'], start: toLocalIso(c.start), end: toLocalIso(c.end) }
    if (c.type === 'proposal') { const task = tk.current.find((t) => t.id === c.taskId); return { type: 'findTime', title: task?.title, hours: c.blockIds.reduce((h, id) => h + (ev.current.find((e) => e.id === id) ? hoursOf(ev.current.find((e) => e.id === id)!) : 0), 0), due: task?.due != null ? toLocalIso(task.due) : undefined } }
    if (c.type === 'readback') return { type: 'createTask', title: c.draft.title, due: c.draft.due ? toLocalIso(c.draft.due) : undefined, hours: c.draft.hours }
    if (c.type === 'change') return { type: c.mode === 'remove' ? 'removeEvent' : 'moveEvent', title: c.title }
    return { type: 'none' }
  }

  /** The waiting card, as the model should see it in the facts */
  function openCardOf(m?: Msg): OpenCard | null {
    const c = m?.card
    if (c?.type === 'event') return { type: 'event', title: c.title, start: c.start, end: c.end, days: c.days, until: c.until, clash: c.clash, alt: c.alt, blocked: c.blocked }
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

  /**
   * A typed yes/no to a waiting card does exactly what its buttons do.
   * pick: on an overlap card, "oo" takes the free time Pal offered ('alt'); "add anyway" keeps the asked one ('orig').
   */
  function answerCard(m: Msg, yes: boolean, line: string, pick: 'alt' | 'orig' = 'alt') {
    const c = m.card
    if (c?.type === 'event') {
      // Pal recommended keeping this and moving the other event: a plain yes does that
      if (yes && pick === 'alt' && c.moveOther && c.kind !== 'exam') {
        // Say what really happened: both changes, with the new time
        palSay(say(pal, 'keptAndMoved', { what: c.title, other: c.moveOther.title, to: `${fmtTime(c.moveOther.to.start)}–${fmtTime(c.moveOther.to.end)}` }), {}, 'happy')
        return onCard(m.id, 'moveOther')
      }
      const alt = yes && c.alt && pick === 'alt' ? c.alt : null
      const when = alt ?? c
      // The confirmation first, so a re-plan card that follows is the newest message.
      // After an overlap, the app says which time it used (the model may name the other one).
      const reply = (yes && c.clash ? '' : line) || say(pal, yes ? 'eventAdded' : 'eventSkipped', { what: `${c.title}, ${fmtDay(when.start)} ${fmtTime(when.start)}` })
      if (alt) return onCard(m.id, 'useAlt', undefined, reply)
      palSay(reply, {}, 'happy')
      return onCard(m.id, !yes ? 'skipEvent' : 'addEvent')
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

  /** What a turn knows about the chat before its own message: the waiting card, the open event card, the history */
  function chatState(before: Msg[]) {
    const recent = before.slice(-8)
    const lastPal = [...recent].reverse().find((m) => m.from === 'pal')
    // The card a typed yes/no answers: the newest one still waiting
    const waitMsg = [...recent].reverse().find((m) => m.from === 'pal' && m.card && !m.resolved && ANSWERABLE.includes(m.card.type))
    const waitIsLatest = !!waitMsg && waitMsg.id === lastPal?.id
    // The newest event card still waiting, so "no, it's lunch" or "make it 3pm" can revise it
    const openMsg = [...recent].reverse().find((m) => m.from === 'pal' && m.card?.type === 'event' && !m.resolved)
    const openCard = openMsg?.card
    const lastEvent = openCard?.type === 'event' ? { title: openCard.title, kind: openCard.kind, start: openCard.start, end: openCard.end, days: openCard.days } : null
    return { recent, waitMsg, waitIsLatest, lastEvent }
  }

  // One AI turn at a time, in the order sent: a local model takes ~10s, and two at once answered out of order
  const queue = useRef<Promise<void>>(Promise.resolve())
  const unanswered = useRef<{ id: string; text: string; voice: boolean }[]>([])
  const [thinking, setThinking] = useState(0)
  function cancelReply() {
    aiRequests.current.cancel()
    unanswered.current.splice(0)
    setThinking(0); setTyping(false)
  }
  useEffect(() => {
    const changed = () => cancelReply()
    const hidden = () => { if (document.hidden) cancelReply() }
    window.addEventListener(AI_MODE_EVENT, changed)
    document.addEventListener('visibilitychange', hidden)
    return () => { aiRequests.current.cancel(); window.removeEventListener(AI_MODE_EVENT, changed); document.removeEventListener('visibilitychange', hidden) }
  }, [])
  const runRef = useRef(runTurn)
  runRef.current = runTurn
  const sendRef = useRef(send)
  sendRef.current = send
  /** voice: said out loud (hands-free), so Pal answers in one short spoken sentence */
  function send(text: string, voice = false) {
    if (classScheduleFile && isYes(text)) return palSay('Please check the class schedule review and use “Confirm and add selected classes” to add it.')
    if (/\b(?:in|speak|reply|answer|use)\s+english\b|mag[- ]?english/i.test(text)) englishSpeechRef.current = true
    if (/\b(?:in|speak|reply|answer|use)\s+tagalog\b|mag[- ]?tagalog/i.test(text)) englishSpeechRef.current = false
    lastByVoice.current = voice
    const id = uid()
    if (!voice) playSound('send')
    setMsgs((m) => [...m, { id, from: 'me', text }])
    // "Hi Jhyvie" to Rei: Rei says who it is, then still handles whatever came after the name
    const wrong = wrongPal(text, pal, settings.userName)
    if (wrong) {
      palSay(say(pal, 'wrongPal', { wrong: wrong.wrong, me: PALS[pal].name }))
      if (!wrong.rest || /^[\s.!?,]*$/.test(wrong.rest)) return
      text = wrong.rest
    }
    const inventoryNow=answerKnowledgeQuestion(text,{query:text,tasks:tk.current,folders:taskFolders,files:knowledgeFiles,now:nowRef.current})
    if(inventoryNow)return palSay(inventoryNow)
    if (titleConfirmation.current) {
      const candidate = titleConfirmation.current
      titleConfirmation.current = null
      const trimmed = text.trim()
      const isCancellation = /^(?:no|hindi|di|wrong|mali|cancel|wag|huwag|stop|never ?mind|shut up)\W*$/i.test(trimmed)
        || /\b(not my plan|that'?s not|not an? event|didn'?t say|di ko sinabi|shut (?:the fuck )?up)\b/i.test(trimmed)
      const isConversational = isQuestion(text) || parseScheduleQuestion(text, nowRef.current) != null
        || /^(?:hi|hello|hey|kamusta|kumusta|how are you|whats up|what's up|thanks|bye|goodbye|salamat|joke|tired|bored|shut)\b/i.test(trimmed)
        || /\b(?:i'?m|i am)\s+(?:just\s+)?asking\b/i.test(trimmed)

      if (isYes(text)) {
        confirmedTitles.current.add(candidate.title)
        text = `the title is ${candidate.title}`
      } else if (isCancellation || isConversational) {
        saveConversation(emptyFocus())
        setDraft(null)
        setAwaiting(null)
        if (isCancellation && /^(?:no|hindi|di|wrong|mali)\W*$/i.test(trimmed)) {
          return palSay('What title should I use?')
        }
      } else if (/^\s*(?:the\s+)?(?:title|name|pangalan)\s+(?:is|ay)\s+/i.test(text) || /^\s*(?:make it|call it|it'?s)\s+/i.test(text)) {
        text = text
      } else if (trimmed.split(/\s+/).length <= 4 && !/[?!]/.test(trimmed)) {
        text = `the title is ${text.replace(/^(?:no|hindi)[,.]?\s*/i, '').trim()}`
      } else {
        saveConversation(emptyFocus())
      }
    }
    const uncertain=text.match(/^\s*(?:ito|iyan)\s+(?:ang|yung)\s+(.+?)[.!?]*$/i)
    if(uncertain){const name=uncertain[1].trim();titleConfirmation.current={title:name,raw:text};saveConversation({...emptyFocus(),intent:'event',title:name,kind:'protected'});return palSay(`Do you mean “${name}” as the title? Say yes or tell me the correct activity.`)}
    const trip=parseTravelIntent(text,nowRef.current)
    if(trip){setTravelDraft(trip);setDraft(null);setAwaiting(null);setPending(null);palSay('Anong oras kayo aalis? Confirm the starting place and destination in Transportation.');return}
    // A ringing timer: "stop", "okay", "tama na" turns it off
    if (ringingRef.current && /^\W*(stop|ok(ay)?|tama na|got it|tigil|sige|thanks|salamat|done)\b/i.test(text)) {
      stopRinging()
      return palSay(say(pal, 'timerStopped'))
    }
    // Conversational sign-off: "thanks", "salamat", "bye", "okay na", etc.
    // The whole message is a sign-off ("okay thanks", "that's all, bye"): Pal says goodbye and the mic stays closed.
    // "Thanks, now add gym at 5" is a request, not a goodbye
    const isDismissal = DISMISSAL.test(text.trim())
    if (isDismissal) {
      followNext.current = false
      const farewell = pal === 'diel'
        ? 'Walang anuman! Sabihan mo lang ako pag kailangan mo ulit.'
        : pal === 'jhyvie'
          ? 'Walang anuman! Andito lang me pag may kailangan ka.'
          : pal === 'jaypee'
            ? 'You got it! Reach out whenever you need me.'
            : "Walang anuman! I'm here whenever you need me."
      return palSay(farewell, { dismissal: true }, 'happy')
    }
    // Timers, reminders, the Study session, "what's next" and "what's my name": rules, instant and exact,
    // so they never wait behind an AI reply
    const s = sessionRef.current
    // Study aids from their own reviewers: rules, so they work offline and don't use the cloud quota
    const aid = text.match(/\b(quiz me|practice quiz|flash ?cards?|read (?:it|this|my [\w-]+|the [\w-]+) (?:aloud|out loud))\b(?:\s+(?:on|about|for|from|sa)\s+(.+?))?[.!?]*$/i)
    if (aid) {
      setLastIntent('study aid')
      return void openStudyAid(/^quiz|practice/i.test(aid[1]) ? 'quiz' : /^flash/i.test(aid[1]) ? 'cards' : 'read', (aid[2] ?? '').trim())
    }
    const cmd = parseCommand(text, nowRef.current, {
      timers: !!newestTimer(alarmsRef.current),
      study: s.phase === 'idle' ? 'idle' : isPaused(s) ? 'paused' : 'running',
      cardWaiting: !!chatState(msgs).waitMsg,
    })
    if (cmd) {
      setLastIntent(cmd.type)
      return runCommand(cmd)
    }
    // "What are my plans tomorrow?", "free time today?", "next schedule?", "how long before my exam?": straight from
    // the calendar, instant and exact on every model (advice like "what do you suggest" still goes to the model)
    const sq = parseScheduleQuestion(text, nowRef.current)
    if (sq) {
      setLastIntent('schedule question')
      const chip = sq.type === 'insights' ? weekInsights(ev.current, tk.current, nowRef.current, settings.prefs).find((i) => i.chip)?.chip : undefined
      return palSay(answerScheduleQuestion(sq, { events: ev.current, tasks: tk.current, now: nowRef.current, prefs: settings.prefs, taglish: pal === 'jhyvie' }), chip ? { chips: [chip] } : {})
    }
    unanswered.current.push({ id, text, voice })
    setThinking((n) => n + 1)
    queue.current = queue.current
      // A beat for React to show the last turn's reply and state, then the newest render's runTurn reads them
      .then(() => new Promise<void>((r) => setTimeout(r, 30)))
      .then(() => {
        // Lines typed while Pal was still answering go in together, the way a person reads them
        // ("Hi" / "hi" / "hoy jhivie" got three slow greetings). An emptied batch means an earlier turn took this line.
        const batch = unanswered.current.splice(0)
        if (batch.length) return runRef.current(batch.map((b) => b.text).join('\n'), batch.some((b) => b.voice), batch[0].id)
      })
      .catch((e) => console.warn('[chat] turn failed', e))
      .finally(() => setThinking(unanswered.current.length))
  }

  /**
   * One chat turn for a message already on screen (id). It sees every Pal reply so far (a card that landed while
   * it waited is the one an "oo" answers), but never the user's own later lines.
   */
  async function runTurn(text: string, voice: boolean, id: string) {
    setThinking(1)
    const lease = aiRequests.current.begin()
    const provider = chooseProvider()
    const idx = msgs.findIndex((m) => m.id === id)
    const { recent, waitMsg, waitIsLatest, lastEvent } = chatState(idx < 0 ? msgs : msgs.filter((m, i) => i < idx || m.from === 'pal'))
    // Pal's past lines carry the action they really sent (the card), so the model remembers what it proposed
    // (last 6 lines: every one is paid for again on each message)
    const history: ChatTurn[] = recent.filter((m) => m.text).slice(-6).map((m) => (m.from === 'me' ? { role: 'user', content: m.text } : { role: 'assistant', content: m.text, action: cardAction(m), outcome: m.resolved ?? (m.card ? 'Waiting for confirmation' : undefined) }))

    // "Add anyway" / "ok lang" to an overlap card: the asked time, no AI needed
    const wc = waitMsg?.card
    const slotReply = wc?.type === 'event' ? suggestedSlotReply(text, wc, nowRef.current) : null
    if (wc?.type === 'event' && wc.alt && slotReply) {
      const range = `${fmtTime(wc.alt.start)}–${fmtTime(wc.alt.end)}`
      if (slotReply === 'clarify') return palSay(pal === 'jhyvie'
        ? `Pareho ang start at end na sinabi mo. Ang ibig mo bang sabihin ay ${range}?`
        : `You gave the same start and end time. Did you mean ${range}?`, { chips: [`Use ${range}`] })
      return onCard(waitMsg!.id, 'useAlt', undefined, say(pal, 'eventAdded', { what: `${wc.title}, ${fmtDay(wc.alt.start)} ${range}` }))
    }
    if (wc?.type === 'event' && wc.clash && ADD_ANYWAY.test(text) && text.split(/\s+/).length <= 8) return answerCard(waitMsg!, true, '', 'orig')
    // "What plan does it block?" about the waiting card: the app knows exactly, so it answers (the model guessed "the free slot")
    if (wc?.type === 'event' && OVERLAP_ASK.test(text)) {
      const hits = [...(wc.clash ?? []), ...(wc.blocked ?? []).map((b) => `study block ${b}`)]
      return palSay(hits.length ? say(pal, 'overlapWhat', { what: hits.join(' and ') }) : say(pal, 'overlapNone'))
    }
    // Pal had asked "what time does it end?": "2 hours" answers it even with no clock time in it
    const wasAwaitingEnd = !!conversationRef.current.awaitingEnd
    const update = updateConversationFocus(conversationRef.current, text, nowRef.current)
    const snap = buildContext(nowRef.current, ev.current, tk.current, weather, settings.prefs, {
      focusTitle: update.focus.title,
      card: openCardOf(waitMsg),
      cardIsLatest: waitIsLatest,
      draft: draft && awaiting && awaiting !== 'confirm' ? draft : null,
      user: settings.userName,
    })
    const knowledgeInput={query:text,tasks:tk.current,folders:taskFolders,files:knowledgeFiles,now:nowRef.current}
    const inventory=answerKnowledgeQuestion(text,knowledgeInput)
    if(inventory)return palSay(inventory)
    snap.full+='\n'+buildPalKnowledge(knowledgeInput,900).text
    const asking = update.directive === 'question'
    const ruled = turn(text, { pal, now: nowRef.current, draft, awaiting, pending, lastEvent, waiting: waitMsg?.card?.type ?? null, waitingIsLatest: waitIsLatest, facts: { next: snap.next, user: settings.userName } })
    // A question that the rules read as "add this" ("do I have gym at 5?"): no card, the model (or "didn't get that") answers
    const t = asking && ruled.action && ['addEvent', 'createTask', 'findTime', 'reviseEvent'].includes(ruled.action.type)
      ? { ...ruled, action: undefined, key: 'unknown' as const, text: say(pal, 'unknown', { next: snap.next }), card: undefined, chips: undefined }
      : ruled
    const a = t.action
    // A model can answer this turn: it words the reply (with the plain-words brief), the fixed lines are the fallback
    // The cloud answers in 1-2s, so it words the questions Pal asks ("when does it end?"); a local model takes 5-10s,
    // so then the instant fixed lines ask them instead
    const cloudWords = provider !== 'local' && provider !== 'native' && cloudReady()
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
    saveConversation(update.focus)
    if (!isSafetyFilterTriggered && !asking) {
      if (update.directive === 'greeting') return palSay(greetLine(pal, settings.userName))
      if (update.directive === 'newRequest' || (update.directive === 'correct' && !update.focus.title)) {
        setDraft(null); setAwaiting(null); setPending(null)
        if (waitMsg) resolve(waitMsg.id, 'Superseded by a new request')
        if (!cloudWords) return palSay(say(pal, 'newEventAsk'))
      }
      if (update.directive === 'decline') {
        setDraft(null); setAwaiting(null); setPending(null)
        return waitMsg ? answerCard(waitMsg, false, '') : palSay(say(pal, 'declineOk'))
      }
      const plans = msgs.flatMap((m) => m.card?.type === 'proposal' ? [m.card.blockIds] : [])
      if (update.focus.intent === 'remove') {
        const group = selectStudyGroup(text, ev.current, plans)
        if (group) return previewChange('', 'remove', group[0], undefined, group)
        const clock = parseWhen(text, nowRef.current)
        if (clock?.hadTime && /\b(ung|yung|mga|the|one|at)\b/i.test(text)) {
          const matches = ev.current.filter((e) => (e.status === 'planned' || e.status === 'proposed') && e.kind !== 'deadline' && e.start === clock.t)
          if (matches.length === 1) return previewChange(say(pal, 'removeAsk'), 'remove', matches[0])
          return palSay(say(pal, 'removeWhichTime'))
        }
        if (/\b(\d+|apat|four|previous|old|dati|mga)\b/i.test(text) && /\b(remove|remoce|delete|tanggal\w*|alisin|bura\w*)\b/i.test(text)) return palSay(say(pal, 'removeWhichPlan'))
        // "Tanggalin mo yung cafe shift ko sa saturday": the event they named (on that day, if they said one). A weekly
        // one with no day given is its next time. Two different names that fit equally: the model asks which
        const said = new Set(terms(text))
        const onDay = namedDay(text, nowRef.current)
        const scored = ev.current
          .filter((e) => (e.status === 'planned' || e.status === 'proposed') && e.kind !== 'deadline' && e.end > nowRef.current && (onDay == null || startOfDay(e.start) === onDay))
          .map((e) => ({ e, score: terms(e.title).filter((w) => said.has(w)).length }))
          .filter((x) => x.score > 0)
        const top = Math.max(0, ...scored.map((x) => x.score))
        const best = scored.filter((x) => x.score === top).sort((a, b) => a.e.start - b.e.start)
        if (best.length && best.every((x) => x.e.title === best[0].e.title)) return previewChange(say(pal, 'removeAsk'), 'remove', best[0].e)
        // "Delete mo pala yan": the event this chat just added
        const justAdded = /\b(yan|iyan|yun|iyon|that|it|this)\b/i.test(text) ? lastAddedEvent(recent) : undefined
        if (justAdded) return previewChange(say(pal, 'removeAsk'), 'remove', justAdded)
      }
      if (update.focus.intent === 'study' && (!waitMsg || (!!parseWhen(text, nowRef.current) && waitMsg.card?.type === 'proposal')) && (/\b(study|review|aral\w*|hours?|hrs?|oras)\b/i.test(text) || isYes(text) || !!parseHours(text) || !!parseWhen(text, nowRef.current))) {
        const study = resolveStudyRequest(update.focus, ev.current, tk.current, nowRef.current)
        // Missing which exam or how many hours: the fixed question offline; with the cloud, the model asks it
        if (!study) { if (!cloudWords) return palSay(say(pal, 'studyWhich')) }
        else if (study.exam && update.focus.due && update.focus.due > study.exam.start) return palSay(say(pal, 'examStill', { what: `${study.exam.title} on ${fmtDay(study.exam.start)} at ${fmtTime(study.exam.start)}` }))
        else if (!study.hours) { if (!cloudWords) return palSay(say(pal, 'studyHours', { what: study.title })) }
        else return findTime({ type: 'findTime', title: study.title, hours: study.hours, perDay: study.perDay, due: toLocalIso(study.due) }, '', { replace: study.replace, notBefore: study.notBefore })
      }
      const focusEvent = eventFromFocus(update.focus)
      const hasUserTime = !!(parseRange(text, nowRef.current) || parseWhen(text, nowRef.current)?.hadTime)
      const f = update.focus
      const what = f.title ?? ''
      if (!cloudWords && f.title && !hasUserTime && !confirmedTitles.current.has(f.title)
        && !/^(?:how are you|how is your day|plan|plans|sched|schedule|event|activity|meeting)$/i.test(f.title)
        && !isQuestion(text) && parseScheduleQuestion(text, nowRef.current) == null && !isGreeting(text)
        && titleNeedsConfirmation(text, f.title)) {
        titleConfirmation.current = { title: f.title, raw: text }
        return palSay(`Is “${f.title}” the right title? You can say yes or tell me the correct title.`)
      }
      const when = f.start != null ? `${fmtDay(f.start)} at ${fmtTime(f.start)}` : ''
      const startWhat = `${what}${f.day != null ? ` on ${fmtDay(f.day)}` : ''}`
      // Never the same question twice in a row: the second time it's rephrased, with a way out
      const lastPal = [...recent].reverse().find((m) => m.from !== 'me')?.text
      const ask = (line: string, again: string) => palSay(line === lastPal ? again : line)
      const askStart = () => ask(say(pal, f.needsSubject ? 'askStartSubject' : 'askStart', { what: startWhat }), say(pal, 'askStartAgain', { what }))
      const askEnd = (fixed: boolean) => ask(say(pal, fixed ? 'fixedAskEnd' : 'askEnd', { what, when }), say(pal, 'askEndAgain', { what }))
      // A correction ("it's not parts", "it's for bio", "no, it starts at 5"): say it's fixed, then the next missing thing
      if (update.directive === 'correct' && f.intent === 'event' && f.title && !focusEvent) {
        if (f.start == null && !cloudWords) return ask(say(pal, 'fixedAskStart', { what: startWhat }), say(pal, 'askStartAgain', { what }))
        if (f.awaitingEnd && !cloudWords) return askEnd(true)
      }
      // Pal is waiting for the end time: ask again only when this message moved things on (a time, or a new start).
      // Anything else ("bakit?", "what do you mean") goes to the model, which knows the end time is still missing
      if (f.intent === 'event' && f.awaitingEnd && f.start != null && (hasUserTime || !wasAwaitingEnd) && !cloudWords) return askEnd(false)
      if (focusEvent && (hasUserTime || wasAwaitingEnd) && !/\b(every|tuwing|daily|araw-araw|weekdays)\b/i.test(text)) {
        setDraft(null); setAwaiting(null)
        return previewEvent(say(pal, 'addAsk', { what: `${focusEvent.title}, ${fmtDay(focusEvent.start)} ${fmtTime(focusEvent.start)}–${fmtTime(focusEvent.end)}` }), focusEvent)
      }
      // "May exam ako bukas", or just the day ("bukas pa naman") after Pal asked the time: the day is noted, the time is still needed
      if (update.focus.intent === 'event' && update.focus.title && !update.focus.start && !waitMsg && (/\b(i have|may|meron|later|mamaya)\b/i.test(text) || namedDay(text, nowRef.current) != null))
        if (!cloudWords) return askStart()
    }
    snap.full += `\n${describeFocus(update.focus)}`
    const noticed = weekInsights(ev.current, tk.current, nowRef.current, settings.prefs).slice(0, 2)
    if (noticed.length) snap.full += `\n- Noticed this week (bring up only if relevant): ${noticed.map((i) => i.text).join(' ')}`
    // The phone's own model is slow (20s+) and often wrong, so on it the rules answer whatever they understood,
    // and the model only gets what they didn't ("unknown")
    const phoneTurn = phoneModelAnswers(provider)
    if (phoneTurn && !isSafetyFilterTriggered && update.focus.intent === 'event' && update.focus.title && update.focus.start == null && !waitMsg && t.key === 'unknown')
      return palSay(say(pal, update.focus.needsSubject ? 'askStartSubject' : 'askStart', { what: `${update.focus.title}${update.focus.day != null ? ` on ${fmtDay(update.focus.day)}` : ''}` }))
    // "friday 9am" to "when is it?", "3 hours" to "how long?": filling the question Pal just asked is the rules' alone
    // (a model took "friday 9am" for a reminder)
    const slotFill = !!draft && text.split(/\s+/).length <= 6 && ((awaiting === 'due' && !!parseWhen(text, nowRef.current)) || (awaiting === 'hours' && !!parseHours(text)))
    const rulesAnswered = (phoneTurn && t.key !== 'unknown') || slotFill
    // Why no model answered, said instead of the rules' "didn't catch that" (one bubble, not two)
    let explain: string | null = null

    // Any model (Groq online, or Ollama on your PC) answers every safe message, mid-task too.
    // A new day or time for the waiting card, or a short "oo" / "wag na" to it, is the rules' alone:
    // no waiting ~10s on your PC's model for an answer that's already decided.
    if (!isSafetyFilterTriggered && !rulesAnswered && a?.type !== 'reviseEvent' && a?.type !== 'confirmEvent' && a?.type !== 'skipEvent') {
      setTyping(true)
      const t0 = performance.now()
      try {
        const groqKey = getGroqApiKey()
        // A local model's words show in the bubble as they arrive (the cloud is fast enough to just answer)
        const streamId = uid()
        const onPartial = (partial: string) => { if (lease.isCurrent() && partial.length > 3) setBubble({ id: streamId, mascotId: palRef.current, text: partial, kind: 'response' }) }
        const ai = await askGroq(text, pal, groqKey, nowRef.current, history, snap, !!waitMsg, { voice, focus: update.focus, provider, signal: lease.signal, onPartial })
        if (!lease.isCurrent()) return
        if (ai?.text) {
          // A reply claiming it already changed something it can't: point at the real way instead
          // "Nasa calendar mo na" about something this chat really added is true, not a claim: keep the model's words
          const trueClaim = ai.claimed === 'add' && !waitMsg && (!ai.action || ai.action.type === 'none')
            && !parseRange(text, nowRef.current) && !parseWhen(text, nowRef.current)?.hadTime && !!lastAddedEvent(recent)
          groqText = ai.claimed && !trueClaim ? claimLine(ai.claimed, ai.action?.type, waitMsg?.card?.type, a?.type) : ai.text
          // The app's reading of the day and time wins ("10am hanggang 1pm mamaya" is today, whatever the model says)
          groqAction = ai.action && alignToMessage(ai.action, text, nowRef.current)
          if(groqAction?.type==='addEvent'&&update.focus.title&&parseWhen(text,nowRef.current)?.hadTime&&!/\b(title|called|named|pangalan)\b/i.test(text))groqAction={...groqAction,title:update.focus.title}
          // "Lock it in" with a card waiting, answered by re-sending that exact card: it's a yes to it.
          // A new time ("make it 10 to 11 instead") is a change, so the times must both match
          if (wc?.type === 'event' && groqAction?.type === 'addEvent' && parseIsoToLocalMs(groqAction.start) === wc.start && parseIsoToLocalMs(groqAction.end) === wc.end)
            groqAction = { type: 'confirmEvent' }
          // Pal talked an event through in words ("i-lock ko na!") but sent no card: recover it from the chat as a card
          if (ai.claimed === 'add' && !trueClaim && !waitMsg && (!ai.action || ai.action.type === 'none') && a?.type !== 'addEvent') {
            // The cloud re-reads the chat; on your PC or phone, the event this conversation already pinned down
            const pinned = eventFromFocus(update.focus)
            const found = await recoverEvent([...history, { role: 'user', content: text }, { role: 'assistant', content: ai.text }], nowRef.current, groqKey, provider)
              ?? (pinned ? { type: 'addEvent' as const, title: pinned.title, kind: pinned.kind as AiAction['kind'], start: toLocalIso(pinned.start), end: toLocalIso(pinned.end) } : null)
            if (!lease.isCurrent()) return
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
        } else {
          failed = aiFailure()
          const nativeIssue = getNativeFailure()
          // Setup problems (no model, can't load) say how to fix it; a missed or turned-down reply is just a friendly retry
          if (nativeIssue && NATIVE_SETUP_ISSUES.includes(nativeIssue)) explain = nativeErrorMessage(nativeIssue)
          else if (nativeIssue && nativeIssue !== 'CANCELLED') explain = say(pal, 'phoneModelMissed')
          else if (provider === 'cloud' && !hasCloudAi()) explain = say(pal, 'cloudNotSet')
        }
      } catch {}
      setTyping(false)
    }
    if (!lease.isCurrent()) return
    // A "redirect" is only trusted when the rules engine also saw nothing to plan (e.g. "math exam tuesday" is in scope)
    if (groqAction?.type === 'redirect' && (a || t.draft)) {
      groqText = null
      groqAction = undefined
    }
    // "okkkk" / "just add it" answered with the very same card again: that's the yes, not a new proposal.
    // The free time Pal offered after an overlap, sent back as a card, is a yes to that time.
    const gs = groqAction?.type === 'addEvent' ? parseIsoToLocalMs(groqAction.start) : null
    if (wc?.type === 'event' && gs != null && ((wc.alt && gs === wc.alt.start)
      || (gs === wc.start && parseIsoToLocalMs(groqAction!.end) === wc.end && (a?.type === 'confirmEvent' || /\b(add|ilagay|lagay|push|lock)\b/i.test(text))))) {
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
    const notice = viaCloud || (explain && t.key === 'unknown') ? null
      : modelLed ? (ci?.kind === 'quota' ? 'quotaLocal' : null) // your PC's model stood in for the cloud
      : failed === 'quota' ? 'quotaOut' : failed === 'rate' ? 'busy' : failed // 'timeout' / 'error' → slowNet, 'offline' below
    if (viaCloud) noticeRef.current = null
    else if (notice && noticeRef.current !== notice) {
      noticeRef.current = notice
      if (notice === 'quotaLocal' || notice === 'quotaOut' || notice === 'busy') palSay(say(pal, notice, { time: ci ? fmtTime(ci.until) : 'later' }))
      else if (notice === 'slowLocal') palSay(say(pal, 'slowLocal'))
      else if (notice !== 'offline') palSay(say(pal, 'slowNet'))
      else palSay(say(pal, 'offlineSimple'))
    }

    // The reply lands before the next queued turn starts, so that turn sees it
    await new Promise<void>((done) => setTimeout(() => { try { respond() } finally { done() } }, modelLed ? 0 : 380 + Math.random() * 380))
    function respond() {
      if (!lease.isCurrent()) return
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
        return answerCard(waitMsg, answer !== 'skipEvent', (agrees ? groqText : t.text) ?? '', ADD_ANYWAY.test(text) ? 'orig' : 'alt')

      // 2. The model leads: its action becomes a card, always confirmed by the user first
      if (modelLed && g) {
        if (g.type === 'addEvent') {
          const startMs = parseIsoToLocalMs(g.start) || nowRef.current
          const endMs = parseIsoToLocalMs(g.end)
          // The model knew when it starts but not when it ends: ask, never assume an hour
          if (!endMs || endMs <= startMs) {
            const title = g.title?.trim() || 'Event'
            setPending({ title, kind: g.kind || 'work', start: startMs, end: startMs, needsEnd: true })
            saveConversation({ ...emptyFocus(), intent: 'event', title, kind: g.kind && g.kind !== 'assignment' ? g.kind : undefined, start: startMs, day: startOfDay(startMs), awaitingEnd: true })
            return palSay(say(pal, 'askEnd', { what: title, when: `${fmtDay(startMs)} at ${fmtTime(startMs)}` }))
          }
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
          if (g.type === 'removeEvent' && g.ids?.length) {
            const ids = [...new Set(g.ids.map((id) => snap.refs[id]))]
            const targets = ids.map((id) => ev.current.find((e) => e.id === id && e.kind === 'work' && e.taskId)).filter((e): e is CalEvent => !!e)
            if (targets.length !== ids.length) return palSay(say(pal, 'removeWhichBlocks'))
            return previewChange('', 'remove', targets[0], undefined, targets)
          }
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
        if (g.type === 'findTime') return findTime(g, groqText || say(pal, 'proposal'), { replace: update.focus.replace, notBefore: update.focus.notBefore })
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
      const replyText = groqText ?? (explain && t.key === 'unknown' ? explain : t.text)
      if (!a) return palSay(replyText, modelLed ? {} : { card: t.card, chips: t.chips, rule: t.rule })
      if (a.type === 'confirmEvent' || a.type === 'skipEvent' || a.type === 'confirmDraft') {
        if (a.type === 'confirmDraft' && !modelLed) return createTask(a.draft)
        return palSay(replyText || say(pal, 'nothingWaiting'))
      }
      if (a.type === 'openSyllabus') {
        palSay(replyText)
        return setSyllabus({})
      }
      if (a.type === 'energy') {
        setSettings((s) => ({ ...s, energy: a.value }))
        return palSay(replyText)
      }
      if (a.type === 'summary') return palSay(groqText || `${summary()} ${snap.insight}`)
      if (a.type === 'weather') {
        setTyping(true)
        const result = provider === 'native' ? Promise.resolve(getCachedWeather()) : refreshWeather()
        return void result.then((w) => lease.commit(() => {
          setTyping(false)
          if (w) setWeather(w)
          palSay(w ? weatherReply(w) : say(pal, 'weatherNone'))
        }))
      }
      if (a.type === 'freeTime') return palSay(freeTimeReply(a.day))
      // The model only talked, but the message had a concrete time: still a card, so "lagay mo 3pm" never dead-ends
      if (a.type === 'addEvent') return previewEvent(replyText || say(pal, a.whatIf ? 'whatIf' : 'eventAdd'), a)
      palSay(replyText)
    }
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
    const today = ev.current.filter((e) => e.start >= n && startOfDay(e.start) === startOfDay(n) && (e.kind !== 'commute' || e.transportSource === 'user-trip') && e.kind !== 'deadline' && e.status !== 'proposed').sort((a, b) => a.start - b.start)
    const ws = startOfWeek(n)
    const week = ev.current.filter((e) => e.kind === 'work' && e.start >= ws && e.start < addDays(ws, 7))
    const planned = week.filter((e) => e.status === 'planned').reduce((a, e) => a + hoursOf(e), 0)
    const done = week.filter((e) => e.status === 'done').reduce((a, e) => a + hoursOf(e), 0)
    const nextDue = datedTasks(tk.current).filter((t) => t.due > n).sort((a, b) => a.due - b.due)[0]
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
    if (m?.resolved && action !== 'chip' && action !== 'commute' && action !== 'classSchedule') return
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
        if (!c.blockIds.length || c.blockIds.some((blockId) => !ev.current.some((e) => e.id === blockId && e.status === 'proposed'))) {
          resolve(id, 'Plan changed; please request new times')
          return palSay('That plan has changed. Ask me for new review times so I can show a current plan.')
        }
        saveConversation({ ...conversationRef.current, intent: 'none' })
        playSound('added')
        const ids = new Set(c.blockIds)
        // Blocks this plan replaces (they overlapped something new) go only now, on Accept
        const gone = new Set(c.replaces ?? [])
        const before = ev.current
        const beforeTasks = tk.current
        setEvents(before.filter((e) => !gone.has(e.id)).map((e) => (ids.has(e.id) && e.status === 'proposed' ? { ...e, status: 'planned' } : e)))
        if (c.taskUpdate) setTasks(beforeTasks.map((task) => task.id === c.taskId ? { ...task, ...c.taskUpdate } : task))
        resolve(id, 'Added to your calendar')
        palSay(line || say(pal, 'accepted'))
        setTimeout(() => feel('happy', 1600), 60)
        toast({ text: `${c.blockIds.length} block${c.blockIds.length > 1 ? 's' : ''} added`, action: { label: 'Undo', fn: () => { setEvents(before); setTasks(beforeTasks); resolve(id, '') } } })
        if (!settings.notifyAsked) {
          setSettings((s) => ({ ...s, notifyAsked: true }))
          setTimeout(() => palSay(say(pal, 'notify'), { card: { type: 'notify' } }), 1400)
        }
      } else if (action === 'decline') {
        saveConversation(emptyFocus())
        const ids = new Set(c.blockIds)
        setEvents(ev.current.filter((e) => !(ids.has(e.id) && e.status === 'proposed')))
        resolve(id, 'Kept your calendar as is')
        palSay(line || say(pal, 'notNow'))
      } else if (action === 'commute') {
        const task = tk.current.find((t) => t.id === c.taskId)
        if (!task) return
        let n = 0
        setEvents(ev.current.map((e) => (e.kind === 'commute' && !e.note && e.start > nowRef.current && e.start < (task.due ?? Infinity) ? (n++, { ...e, note: `Flashcards · ${task.title}` }) : e)))
        setMsgs((ms) => ms.map((x) => (x.id === id ? { ...x, card: { ...c, commute: false } } : x)))
        setTimeout(() => toast({ text: `Light review added to ${n} bus ride${n === 1 ? '' : 's'}` }), 0)
      }
      return
    }
    if (c?.type === 'checkin' && arg) return answerCheckin(arg, action as 'done' | 'partly' | 'notyet')
    if (c?.type === 'file') {
      if (action === 'classSchedule') return void getFile(c.fileId).then(file => {
        if (!file || !supportedScheduleFile(file)) return palSay('This attachment is unavailable or unsupported. Use a PNG, JPEG, WebP, PDF, or DOCX school schedule.')
        setClassScheduleFile(file)
      }).catch(() => palSay('The attachment could not be opened. Please attach it again.'))
      // "Add its dates to my schedule": the file's own text, scanned, in the checklist to confirm
      if (action === 'schedule') return void getFile(c.fileId).then((f) => {
        const text = f?.chunks.map((x) => x.text).join('\n') ?? ''
        if (!text.trim()) return palSay(say(pal, 'fileNoText', { file: c.name }))
        setSyllabus({ text, source: c.name })
      })
      // "Study it": flashcards first; a quiz is one "quiz me" away
      if (action === 'study') {
        if (c.scanned) return palSay(say(pal, 'fileNoText', { file: c.name }))
        palSay(say(pal, 'fileStudy', { file: c.name }), { chips: ['Quiz me', 'Plan study time'] })
        return openInLibrary({ fileId: c.fileId, mode: 'cards' })
      }
      if (action !== 'plan') return openInLibrary({ fileId: c.fileId, mode: action as LibraryMode })
      return void (async () => {
        const f = await getFile(c.fileId)
        const folder = f && (await listFolders()).find((x) => x.id === f.folderId)
        if (f && folder) planFromFile(f, folder)
      })()
    }
    if (c?.type === 'event') {
      if (action === 'skipEvent') { saveConversation(emptyFocus()); return resolve(id, 'Not added') }
      // "Use 5:15am": the free time Pal suggested instead of the clash; "Add anyway" keeps the asked time
      const use = action === 'useAlt' && c.alt ? c.alt : { start: c.start, end: c.end }
      const repeats = c.days?.length ? occurrences(use.start, use.end, c.days, nowRef.current, c.until) : []
      const slots = repeats.length ? repeats : [use]
      if (action === 'useAlt' && clashes(slots, ev.current).length) return previewEvent('', { ...c, start: use.start, end: use.end })
      saveConversation({ ...conversationRef.current, intent: 'none' })
      if (line) palSay(line, {}, 'happy')
      const added: CalEvent[] = slots.map((s) => ({ id: uid(), title: c.title, kind: c.kind as CalEvent['kind'], start: s.start, end: s.end, status: 'planned' }))
      const hit = ev.current.filter((e) => e.kind === 'work' && e.taskId && (e.status === 'planned' || e.status === 'proposed') && added.some((a) => e.start < a.end && e.end > a.start))
      // "Move Bus home to 6pm": the ride shifts out of the way, the asked time stays
      const shift = action === 'moveOther' ? c.moveOther : undefined
      // Unaccepted suggestions under it go now. Accepted study blocks stay until the user accepts new times for them.
      const base = [...ev.current.filter((e) => !(hit.includes(e) && e.status === 'proposed')).map((e) => (shift && e.id === shift.id ? { ...e, ...shift.to } : e)), ...added]
      // Study blocks under it (accepted or still suggested) mean a re-plan card follows
      const replan = hit.length > 0
      showWeekOf(added[0].start)
      setView('week')
      // Keep the chat open when a re-plan card is coming, so its Accept button is in reach
      if (mobile && !replan) setChatOpen(false)
      const moved = use === c.alt ? ` at ${fmtTime(use.start)}` : shift ? (shift.trimmed ? `, ${shift.title} now ${fmtTime(shift.to.start)}–${fmtTime(shift.to.end)}` : `, ${shift.title} moved to ${fmtTime(shift.to.start)}`) : ''
      playSound('added')
      resolve(id, replan ? `Added${moved}. New times for the overlap below` : added.length > 1 ? `Added ${added.length} sessions${moved}${c.until ? ` until ${fmtDay(c.until)}` : ' over the next 8 weeks'}` : `Added${moved}`)
      setTimeout(() => feel('happy', 1400), 60)
      const affected = [...new Set(hit.map((e) => e.taskId).filter(Boolean))] as string[]
      if (affected.length) {
        const replaces = hit.filter((e) => e.status === 'planned' && e.taskId === affected[0]).map((e) => e.id)
        reflow(affected[0], base, 0, { replaces, lead: say(pal, 'conflictReflow', { what: c.title }) })
      } else {
        setEvents(base)
        flash(added.map((a) => a.id))
        // Like a good secretary: if this made the day worse (no break, no dinner, 10 hours), say so once, with a fix
        const fresh = newInsights(dayInsights(added[0].start, ev.current, tk.current, nowRef.current, settings.prefs), dayInsights(added[0].start, base, tk.current, nowRef.current, settings.prefs))
          .find((i) => !nudged.current.has(i.id) && i.day === startOfDay(added[0].start))
        if (fresh) {
          nudged.current.add(fresh.id)
          setTimeout(() => palSay(pal === 'jhyvie' ? fresh.textTl : fresh.text, fresh.chip ? { chips: [fresh.chip] } : {}), 900)
        }
      }
      return
    }
    if (c?.type === 'change') {
      if (action === 'keep') {
        resolve(id, 'Kept')
        return palSay(line || say(pal, 'kept'))
      }
      const before = ev.current
      const ids = new Set(c.targets ? c.targets.map((target) => target.id) : action === 'removeAll' && c.seriesIds?.length ? c.seriesIds : [c.eventId])
      if (!before.some((e) => ids.has(e.id))) return resolve(id, 'Already gone')
      const undo = { label: 'Undo', fn: () => { setEvents(before); resolve(id, '') } }
      if (c.mode === 'remove') {
        const targets = c.targets ?? before.filter((e) => ids.has(e.id)).map((e) => e.id === c.eventId ? { id: c.eventId, title: c.title, start: c.start, end: c.end } : e)
        const next = removePreviewedEvents(before, targets)
        if (!next) {
          resolve(id, 'Calendar changed; please select the blocks again')
          return palSay('Those blocks have changed since this preview. Please select them again before removing them.')
        }
        setEvents(next)
        saveConversation(emptyFocus())
        playSound('removed')
        resolve(id, ids.size > 1 ? `Removed ${ids.size}` : 'Removed')
        toast({ text: `Removed “${c.title}”${ids.size > 1 ? ` ×${ids.size}` : ''}`, action: undo })
        palSay(line || say(pal, 'removed', { what: c.title }), {}, 'happy')
      } else if (c.to) {
        const to = c.to
        setEvents(before.map((e) => (e.id === c.eventId ? { ...e, start: to.start, end: to.end } : e)))
        playSound('added')
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
    const soon = events.filter((e) => e.status === 'planned' && e.kind !== 'deadline' && (e.kind !== 'commute' || e.transportSource === 'user-trip') && e.start > now && e.start <= now + 10 * MIN && !alerted.includes(e.id))
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
  /**
   * After a bare "Hi {pal}": the browser's live recognizer takes the request, the same one tap-to-talk uses, so
   * their words show under the mic as they talk (and arrive sooner than a whole clip through Whisper).
   * Device-only, or no recognizer here (the Android app): the on-device path takes it as before.
   */
  const wakeCaptureStarting = useRef(false)
  async function liveAfterWake(ack: string): Promise<boolean> {
    // (ack: a line Pal said that the mic may catch; '' now that Pal stays quiet after the wake)
    if (!SR || settings.sttDeviceOnly || micOn || recRef.current || liveBroken.current || wakeCaptureStarting.current) return false
    wakeCaptureStarting.current = true
    try {
      // Release the detector's microphone before the browser recognizer requests it.
      await handOffListening()
      if (!isHandsFreeOn()) return false
      const r = new SR()
      r.lang = recognitionLanguage(palRef.current, navigator.language)
      r.interimResults = true
      // The app decides when they're done (SEND_AFTER_SILENCE_MS of no new words), not Chrome: it sent mid-sentence
      r.continuous = true
      const quiet = endAfterSilence(r)
      r.onspeechstart = () => quiet.speaking()
      let final = ''
      let transcript = ''
      let retried = false
      r.onstart = () => {
        if (recRef.current !== r) return
        setMicOn(true)
        announceWakeReady()
      }
      r.onresult = (e: any) => {
        quiet.heard()
        const result = readRecognitionResults(e.results)
        final = result.final
        transcript = result.text
        setInterim(stripWakePhrase(transcript, palRef.current, settings.userName))
      }
      // "no-speech", "aborted": onend follows and hands back to hands-free. Refused outright (Safari without
      // Dictation, blocked mic, no network): the on-device path takes this request and the next ones
      let refused = false
      r.onerror = (e: any) => {
        if (/not-allowed|service-not-allowed|audio-capture|network|language-not-supported/.test(e?.error ?? '')) refused = liveBroken.current = true
      }
      r.onend = () => {
        quiet.done()
        const said = (transcript || final).trim()
        // It only caught Pal's own "Yes?": listen once more for the real request
        if (said && isEcho(said, ack, palRef.current) && !retried) {
          retried = true
          final = transcript = ''
          setInterim('')
          try { r.start(); return quiet.heard() } catch {}
        }
        recRef.current = null
        setMicOn(false)
        setInterim('')
        void resumeListening().then(() => {
          if (refused && !said) { expectFollowUp(); if (isHandsFreeOn()) announceWakeReady() }
        })
        if (said && !isEcho(said, ack, palRef.current)) {
          lastVoice.current = Date.now()
          // "Hi Rei" again: just listening again. "Hi Rei, add …": execute the inquiry
          const command = stripWakePhrase(said, palRef.current, settings.userName).trim()
          if (!command) return void resumeListening().then(() => liveAfterWakeRef.current(ack))
          setHeard(command)
          sendRef.current(command, true)
        }
      }
      recRef.current = r
      try {
        r.start()
        quiet.started()
        return true
      } catch {
        recRef.current = null
        // No live recognizer after all: the on-device path takes the next sentence
        await resumeListening()
        expectFollowUp()
        return false
      }
    } catch {
      await resumeListening()
      expectFollowUp()
      return false
    } finally {
      wakeCaptureStarting.current = false
    }
  }
  /**
   * A recognizer left running (continuous) until they've been quiet SEND_AFTER_SILENCE_MS after their last words,
   * NOTHING_SAID_MS if they never start, MAX_TALK_MS at most. speaking(): a voice was detected. heard(): new words came in.
   */
  function endAfterSilence(r: { stop: () => void }) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cap: ReturnType<typeof setTimeout> | undefined
    const wait = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { try { r.stop() } catch {} }, ms) }
    let words = false
    return {
      started: () => { wait(NOTHING_SAID_MS); cap = setTimeout(() => { try { r.stop() } catch {} }, MAX_TALK_MS) },
      // They started talking inside the 3 seconds: don't close on them while their first words are on the way
      speaking: () => { if (!words) wait(WORDS_PENDING_MS) },
      heard: () => { words = true; wait(SEND_AFTER_SILENCE_MS) },
      done: () => { clearTimeout(timer); clearTimeout(cap) },
    }
  }
  /** The live recognizer refused once (e.g. Safari without Dictation): stop trying it this session */
  const liveBroken = useRef(false)
  const liveAfterWakeRef = useRef(liveAfterWake)
  liveAfterWakeRef.current = liveAfterWake

  async function toggleMic() {
    // No speech service here (the Android app, Firefox): hear one sentence with the on-device Whisper instead
    if (!SR || settings.sttDeviceOnly) {
      if (!navigator.mediaDevices?.getUserMedia) return micFail('unsupported')
      // Hands-free is always listening: a tap means "this next sentence is for you", no "Hi Rei" needed
      if (isHandsFreeOn()) {
        if (micOn) return setMicOn(false)
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
    stopKokoro(); stopNative()
    await handOffListening()
    const r = new SR()
    r.lang = recognitionLanguage(palRef.current, navigator.language)
    r.interimResults = true
    r.continuous = true
    const quiet = endAfterSilence(r)
    r.onspeechstart = () => quiet.speaking()
    let final = ''
    let transcript = ''
    r.onresult = (e: any) => {
      quiet.heard()
      const result = readRecognitionResults(e.results)
      final = result.final
      transcript = result.text
      setInterim(stripWakePhrase(transcript, palRef.current, settings.userName))
    }
    r.onend = () => {
      quiet.done()
      setMicOn(false)
      setInterim('')
      recRef.current = null
      void resumeListening()
      const command = stripWakePhrase(transcript || final, palRef.current, settings.userName)
      if (command) { setHeard(command); sendRef.current(command, true) }
    }
    r.onerror = (e: any) => micFail(e.error)
    recRef.current = r
    try {
      r.start()
      quiet.started()
      setMicOn(true)
      if (micStopEarly.current) r.stop()
    } catch {
      recRef.current = null
      void resumeListening()
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

  function finishOnboarding(v: { pal: PalId; name: string; energy?: Energy; advancedMode?: boolean; userName?: string; notify?: boolean }) {
    const first = !settings.onboarded
    const { notify, ...rest } = v
    // A fresh start: sounds on, and this "Start" tap lets the app make sound from now on
    if (first) { setSoundsOn(true); unlockChime() }
    setSettings((s) => ({ ...s, ...rest, energy: v.energy ?? s.energy, onboarded: true, advancedMode: v.advancedMode ?? s.advancedMode ?? false, ...(notify != null ? { notify, notifyAsked: true } : {}) }))
    setEditing(false)
    if (first)
      setTimeout(() => {
        setMsgs([])
        setBubble({ id: uid(), mascotId: v.pal, text: greetLine(v.pal, v.userName), kind: 'greeting' })
        feel('wave', 1600)
      }, 250)
  }

  function clearAllPlans() {
    saveConversation(emptyFocus())
    const beforeEv = ev.current, beforeTk = tk.current
    setEvents([])
    setTasks([])
    setClearing(false)
    feel('shocked', 1100)
    toast({ text: 'All plans deleted', action: { label: 'Undo', fn: () => { setEvents(beforeEv); setTasks(beforeTk) } } })
  }

  function resetDemo() {
    saveConversation(emptyFocus())
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
      onSend={send} onCard={onCard} onHover={setHover} onTyping={setTyping} thinking={thinking > 0}
      onCancelReply={cancelReply}
      onAttach={attachFile}
      voiceOn={settings.voiceOn}
      setVoiceOn={(v) => {
        setSettings((s) => ({ ...s, voiceOn: v }))
        if (v) speak(say(pal, 'voiceOn'), true)
        else { window.speechSynthesis?.cancel(); stopKokoro(); stopNative() }
      }}
      micOn={micOn} toggleMic={toggleMic} micSupported={!!SR || !!navigator.mediaDevices?.getUserMedia} interim={interim} compact={mobile} noPal={(view === 'home' || view === 'study') && !chatOpen}
      handsFree={{ on: settings.onboarded, state: hf.state, progress: hf.progress, mic: hf.mic, tap: hf.tap, error: hf.error, heard }}
      onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)}
      open={chatOpen} setOpen={setChatOpen} onCollapse={mobile ? undefined : toggleCollapse}
    />
  )

  // The demo's time machine: only for testing (Advanced Mode), or while time is shifted so "Now" can bring it back
  const showSim = !!settings.advancedMode || offset !== 0
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

  // On a phone: just the pal you're with; tap it for the others (four avatars pushed Settings off a 360px screen)
  const [palMenu, setPalMenu] = useState(false)
  const palChip = (
    <div className="relative shrink-0">
      <button
        onClick={() => setPalMenu((o) => !o)}
        aria-haspopup="true"
        aria-expanded={palMenu}
        aria-label={`${PALS[pal].name}. Switch pal`}
        className="press flex h-10 items-center gap-1.5 rounded-full bg-ink py-1 pr-3 pl-1 text-paper shadow-[var(--edge)]"
      >
        <span className="grid size-8 place-items-center overflow-hidden rounded-full" style={{ background: PALS[pal].swatch }}>
          <Pal id={pal} size={30} state={palState} animate />
        </span>
        <span className="text-[13px] font-semibold">{PALS[pal].name}</span>
      </button>
      {palMenu && (
        <>
          <button aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={() => setPalMenu(false)} />
          <div className="pop liquid-solid absolute top-full right-0 z-50 mt-2 flex gap-1 rounded-full p-1 shadow-[var(--shadow-lg)]" role="radiogroup" aria-label="Switch pal">
            {(Object.keys(PALS) as PalId[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={id === pal}
                title={PALS[id].name}
                aria-label={PALS[id].name}
                onClick={() => { switchPal(id); setPalMenu(false) }}
                className={`press grid size-10 place-items-center rounded-full ${id === pal ? 'bg-ink' : 'hover:bg-ink/[0.05]'}`}
              >
                <span className="grid size-8 place-items-center overflow-hidden rounded-full" style={{ background: PALS[id].swatch }}>
                  <Pal id={id} size={30} state="idle" />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  const openPop = (e: CalEvent, rect: DOMRect) => setPop({ ev: e, rect })
  const openTasks = tasks.filter(t=>!isTaskDone(t)).length
  const goWeek = (i: number) => {
    setWeekOff(0)
    setDayIdx(i)
    setView('week')
  }

  const weekNav = (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-y-1 sm:flex-nowrap">
      <button className="tool-button-primary" onClick={()=>setScheduleEdit({event:null})}>Add schedule</button>
      <button onClick={() => setWeekOff((w) => w - 1)} className="press grid size-10 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Previous week"><ChevronL /></button>
      <span className="tnum min-w-[96px] text-center text-[14px] font-semibold">{weekLabel}</span>
      <button onClick={() => setWeekOff((w) => w + 1)} className="press grid size-10 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Next week"><ChevronR /></button>
      <button onClick={() => setClearing(true)} className="press ml-1 grid size-10 place-items-center rounded-full text-ink-3 hover-lift hover:text-red-500" aria-label="Delete all plans" title="Delete all plans"><Trash /></button>
      {weekOff !== 0 && <button onClick={() => setWeekOff(0)} className="pop press ml-1 h-8 rounded-full bg-accent-soft px-3 text-[12px] font-medium text-ink">This week</button>}
    </div>
  )

  const content =
    view === 'home' ? (
      <Today onAddSchedule={()=>setScheduleEdit({event:null})} onStudy={section=>{setStudySection(section);setView('study')}} prefs={settings.prefs} focusActive={active(session)} onPrepare={(task, minutes) => { setFocusSetup({ method: 'custom', focusMinutes: minutes, breakMinutes: 0, rounds: 1, taskId: task.id, goal: task.title }); setStudySection('focus'); setView('study') }} now={now} events={events} tasks={tasks} onOpen={openPop} onPlan={planTask} onWeek={goWeek} onTasks={() => setView('tasks')} pal={pal} palState={palState} onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)} onPip={openCompanion} />
    ) : view === 'study' ? (
      <Study
        session={session}
        setupConfig={focusSetup}
        onSetupDone={() => setFocusSetup(null)}
        pal={pal}
        palState={mood ? mood.state : session.phase === 'break' ? 'happy' : 'idle'}
        todayMinutes={Math.floor(todayFocus)}
        palLine={studyLine}
        alarmsOn={settings.notify}
        onStart={studyStart}
        onConfigure={studyConfigure}
        onNext={studyNext}
        onRecover={studyRecover}
        onBrowse={(id) => { setBrowseFolderId(id); setStudySection('library') }}
        browseFolderId={browseFolderId}
        onBrowseDone={() => setBrowseFolderId(null)}
        onPause={studyPause}
        onResume={studyResume}
        onSkip={studySkip}
        onStop={studyStop}
        onEnableAlarms={turnOnAlarms}
        tasks={tasks}
        section={studySection}
        onSection={setStudySection}
        libraryTarget={libraryTarget}
        onLibraryTargetDone={() => setLibraryTarget(null)}
        onPlanFile={planFromFile}
        onToast={(text) => toast({ text })}
        tabsInHeader={!mobile}
      />
    ) : view === 'tasks' ? (
      <Tasks now={now} tasks={tasks} events={events} folders={taskFolders} onCreate={()=>setTaskEdit({task:null})} onEdit={id=>{const task=tk.current.find(t=>t.id===id);if(task)setTaskEdit({task})}} onQuickAdd={title=>saveManualTask({title,kind:'task',notes:'',status:'pile',hours:0})} onMove={moveManualTask} onPlan={t=>t.due ? planTask(t) : setTaskEdit({task:t})} onAdd={(t) => { send(t); if (mobile) setChatOpen(true) }} />
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
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 py-1">{weekNav}{showSim && simCluster}</div>
        <div className="min-h-0 flex-1">
          <Calendar days={shownDays} now={now} events={events} pal={pal} highlight={hl} onOpen={openPop} quiet={QUIET} />
        </div>
      </div>
    ) : (
      // Desktop: the week's nav and controls live in the panel's top bar (panelLeft below)
      <div className="h-full">
        <Calendar days={shownDays} now={now} events={events} pal={pal} highlight={hl} onOpen={openPop} quiet={QUIET} />
      </div>
    )

  // Desktop panel top bar, left side: the view's own controls, so they share the row with the badge and pals
  const panelLeft = view === 'week' ? (
    <div className="flex min-w-0 items-center gap-x-4">
      {weekNav}
      {showSim && simCluster}
      <div className="hidden xl:block"><LoadStrip weekStart={weekStart} events={events} active={weekOff === 0 ? (new Date(now).getDay() + 6) % 7 : undefined} onPick={(i) => setDayIdx(i)} /></div>
    </div>
  ) : view === 'study' ? (
    <StudyTabs section={studySection} onSection={setStudySection} />
  ) : null

  return (
    <div ref={shellRef} className={`${!mobile && view === 'home' ? 'desktop-today' : ''} app-shell ${mobile ? 'is-mobile' : ''} grain relative isolate flex h-dvh overflow-hidden p-3 pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] sm:p-4 ${mobile ? 'flex-col gap-2' : 'gap-3 sm:gap-4'}`}>
      <div className="mist" aria-hidden />

      {mobile ? (
        <>
          <header className="mobile-header flex shrink-0 items-center gap-2 px-2">
            <Wordmark className="shrink-0 text-[18px]" />
            <div className="min-w-0 flex-1" />
            {settings.advancedMode && (
              <StatusBadge
                isOnline={isOnline}
                hasGroqKey={hasCloudAi()}
                activeModel={activeModel}
                latency={lastLatency}
                lastIntent={lastIntent}
                compact
                onOpenSettings={() => setEditing(true)}
              />
            )}
            {palChip}
            <button
              onClick={() => setEditing(true)}
              className="press grid size-10 shrink-0 place-items-center rounded-full text-ink-2"
              aria-label="Pal and preferences"
              title="Pal and preferences"
            >
              <Gear className="size-[18px]" />
            </button>
          </header>
          <main key={view} className={`${(dockMin || view === 'tasks') && !chatOpen ? 'under-dock-min' : 'under-dock'} view-in liquid min-h-0 flex-1 overflow-hidden rounded-[28px]`}>{content}</main>
          {/* Floating composer + pal above the tab bar; tap expands into the full conversation */}
          {chatOpen && <button aria-label="Close chat" onClick={() => setChatOpen(false)} className="fixed inset-0 z-30 bg-ink/10 backdrop-blur-[2px]" />}
          {(dockMin || view === 'tasks') && !chatOpen ? (
            // Minimized: just the pal, bottom right. Tap brings the text box and mic back.
            <button
              type="button"
              onClick={() => { setDockMin(false); if(view === 'tasks')setChatOpen(true) }}
              aria-label={`Show the chat with ${name}${unseen ? ', new message' : ''}`}
              className="pop press liquid-solid fixed right-4 z-40 grid size-14 place-items-center rounded-full"
              style={{ bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 70px)' }}
            >
              <span className="grid size-11 place-items-center overflow-hidden rounded-full" style={{ background: PALS[pal].swatch }}>
                <Pal id={pal} size={40} state={palState} animate />
              </span>
              {settings.onboarded && hf.state !== 'off' && <span className="absolute inset-0 rounded-full ring-2 ring-accent/60" aria-hidden />}
              {unseen && <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-accent ring-2 ring-paper" aria-hidden />}
            </button>
          ) : (
            <div
              ref={dockRef} data-open={chatOpen} className="chat-dock liquid-solid fixed inset-x-3 z-40 flex flex-col rounded-[30px] transition-[top] duration-[420ms] [transition-timing-function:var(--ease-drawer)]"
              style={{ top: chatOpen ? 'calc(env(safe-area-inset-top, 0px) + 60px)' : 'auto', bottom: chatOpen ? 'max(12px, env(safe-area-inset-bottom))' : 'calc(max(12px, env(safe-area-inset-bottom)) + 60px)' }}
            >
              {!chatOpen && (
                <button
                  type="button"
                  onClick={() => setDockMin(true)}
                  aria-label="Minimize the chat"
                  title="Minimize"
                  className="press absolute -top-3.5 right-4 z-50 grid h-7 w-10 place-items-center rounded-full bg-paper text-ink-2 shadow-[var(--edge),0_4px_12px_-4px_rgb(0_0_0/0.25)] hover:text-ink"
                >
                  <ChevronD className="size-4" />
                </button>
              )}
              <div className="chat-dock-content">{chat}</div>
            </div>
          )}
          <div className="fixed inset-x-3 z-30" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <TabBar view={view} setView={(v) => { setView(v); setChatOpen(false) }} taskCount={openTasks} studying={active(session)} />
          </div>
        </>
      ) : (
        <>
          <Rail view={view} setView={setView} onSyllabus={() => setSyllabus({})} onSettings={() => setEditing(true)} onPip={openCompanion} taskCount={openTasks} dark={dark} onTheme={() => setDark((d) => !d)} studying={active(session)} />
          <aside
            className={`liquid relative min-h-0 shrink-0 overflow-hidden rounded-[30px] ${instant ? '' : 'transition-[width,opacity,transform,margin] duration-[260ms] [transition-timing-function:var(--ease-out)]'} ${collapsed ? 'pointer-events-none -mr-4 w-0 -translate-x-4 opacity-0' : 'w-[clamp(320px,31vw,480px)]'}`}
            aria-hidden={collapsed}
          >
            <div className="h-full w-[clamp(320px,31vw,480px)]">{chat}</div>
          </aside>
          <section className={`liquid relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] ${view === 'home' ? 'today-panel' : ''}`}>
            {/* Its own row, not floating over the page: nothing in any view can slide under the badge or the pals */}
            <header className="@container relative z-30 flex h-14 shrink-0 items-center gap-3 pr-3 pl-4">
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">{panelLeft}</div>
              <div className="flex shrink-0 items-center gap-2">
                {settings.advancedMode && (
                  <StatusBadge
                    isOnline={isOnline}
                    hasGroqKey={hasCloudAi()}
                    activeModel={activeModel}
                    latency={lastLatency}
                    lastIntent={lastIntent}
                    compact
                    onOpenSettings={() => setEditing(true)}
                  />
                )}
                {/* All four pals when the panel has room; the one-pal chip (as on a phone) when it doesn't */}
                <div className="hidden @[620px]:block">{palSwitch}</div>
                <div className="@[620px]:hidden">{palChip}</div>
              </div>
            </header>
            <div key={view} className="view-in min-h-0 flex-1">{content}</div>
          </section>
          {collapsed && (
            <button
              onClick={toggleCollapse}
              className={`liquid-solid press fixed right-6 bottom-6 z-30 grid size-[72px] place-items-center rounded-full ${instant ? '' : 'pop'}`}
              aria-label={`Open chat with ${name} (⌘/)`}
              title="Open chat  ⌘/"
            >
              <Pal id={pal} state={palState} size={34} float />
              {micOn && <span className="pulse-dot absolute top-2 right-2 size-2.5 rounded-full bg-accent" />}
            </button>
          )}
        </>
      )}

      {pop && (
        <BlockPopover onEdit={()=>{setScheduleEdit({event:pop.ev});setPop(null)}}
          ev={pop.ev} rect={pop.rect} onClose={() => setPop(null)}
          onDone={() => { answerCheckin(pop.ev.id, 'done'); setPop(null) }}
          onAccept={() => { setEvents(ev.current.map((x) => (x.id === pop.ev.id ? { ...x, status: 'planned' } : x))); setPop(null) }}
          onDelete={() => deleteEvent(pop.ev)}
        />
      )}
      {clearing && <DeletePlansSheet onClose={() => setClearing(false)} onConfirm={clearAllPlans} count={events.length} />}
      {travelDraft&&<TravelPlanner draft={travelDraft} onClose={()=>setTravelDraft(null)} onSave={trip=>{setTravelDraft(null);setScheduleEdit({isNew:true,event:{id:uid(),title:`Travel to ${trip.destination?.label.split(',')[0]}`,kind:'commute',status:'proposed',start:trip.departure!,end:trip.departure!+Math.ceil(trip.estimate!.durationSeconds/60)*60000,travel:trip,transportSource:'user-trip',note:trip.notes}})}}/>}
      {scheduleEdit&&<ScheduleEditor event={scheduleEdit.event} onSave={saveManualSchedule} onClose={()=>setScheduleEdit(null)}/>}
      {attachmentFiles.length>0&&<AttachmentPlacement files={attachmentFiles} folders={taskFolders} onChoose={placeAttachments} onCancel={()=>setAttachmentFiles([])}/>}
      {taskEdit && <TaskEditor task={taskEdit.task} folders={taskFolders} onSave={saveManualTask} onClose={()=>setTaskEdit(null)} />}
      {classScheduleFile && <ClassScheduleImport key={classScheduleFile.id} file={classScheduleFile} events={events} onClose={() => setClassScheduleFile(null)} onViewCalendar={() => { setClassScheduleFile(null); setView('week'); setWeekOff(0) }} onCommit={(draft: ClassDraft, approval: string) => {
        const batch = reviewClassImport(draft, ev.current, Date.now())
        if (batch.conflicts.length && approval !== conflictKey(batch.conflicts)) throw new Error('The calendar or selected classes changed. Review the latest overlaps and explicitly approve them before adding.')
        if (!batch.events.length && batch.duplicates) return { added: 0, skipped: batch.duplicates }
        if (!batch.events.length) throw new Error('No new upcoming classes remain. Check the date range and selections.')
        const next = [...ev.current, ...batch.events]
        // Persist before updating React or reporting success. A storage failure leaves the review intact.
        try { localStorage.setItem(KEY, JSON.stringify({ settings, events: next, tasks: tk.current, msgs: msgs.slice(-80), asked, alerted, log, offset, session, focusLog, alarms, conversation } satisfies Saved)) }
        catch { throw new Error('Calendar could not be saved on this device. Free storage space and retry; no classes were added.') }
        ev.current = next; setEvents(next)
        return { added: batch.events.length, skipped: batch.duplicates }
      }} />}
      {syllabus && <SyllabusSheet key={syllabus.source ?? 'paste'} now={now} initialText={syllabus.text} source={syllabus.source} onClose={() => setSyllabus(false)} onAdd={addSyllabus} />}
      {!settings.onboarded && <Welcome onDone={finishOnboarding} />}
      {settings.onboarded && editing && (
        <SettingsScreen
          settings={settings}
          onChange={(patch) => {
            setSettings((s) => ({ ...s, ...patch }))
            if (patch.voiceOn === false) { window.speechSynthesis?.cancel(); stopKokoro(); stopNative(); stopSpeech() }
          }}
          onClose={() => {
            setEditing(false)
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Pal and preferences"]')?.focus())
          }}
          dark={dark}
          onTheme={setDark}
          onEnableReminders={turnOnAlarms}
          onSyllabus={() => { setEditing(false); setSyllabus({}) }}
          prefsLabel={[
            settings.prefs?.latestHour != null ? `Nothing after ${fmtTime(new Date().setHours(settings.prefs.latestHour, 0, 0, 0))}` : '',
            settings.prefs?.blockedDays?.length ? `${settings.prefs.blockedDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} kept free` : '',
          ].filter(Boolean).join(' · ')}
          onClearPrefs={() => setSettings((s) => ({ ...s, prefs: {} }))}
          handsFree={{
            on: isHandsFreeOn(),
            deviceOnly: !!settings.sttDeviceOnly,
            setDeviceOnly: (v) => setSettings((s) => ({ ...s, sttDeviceOnly: v })),
          }}
          onDemoWeek={() => { resetDemo(); setEditing(false) }}
        />
      )}
      <FloatingCompanionManager
        pipWindow={pipWindow}
        inAppFloating={inAppFloating}
        pal={pal}
        palName={PALS[pal].name}
        palState={palState}
        session={session}
        bubble={bubble}
        handsFree={hf}
        events={events}
        now={now}
        onPoke={() => feel(Math.random() < 0.5 ? 'happy' : 'wave', 1300)}
        onStartPomodoro={() => {
          studyConfigure({ method: 'pomodoro', focusMinutes: 25, breakMinutes: 5, rounds: 4 })
          studyStart()
        }}
        onPauseSession={studyPause}
        onResumeSession={studyResume}
        onStopSession={() => studyStop(false)}
        onOpenApp={() => {
          try {
            window.focus()
          } catch {}
          if (pipWindow) {
            pipWindow.close()
          }
        }}
        onClose={closeCompanion}
        onOpenCompanion={openCompanion}
      />
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

