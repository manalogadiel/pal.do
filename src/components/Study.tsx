import { ToolInstrument, type ToolId } from './ToolInstrument'
import { useEffect, useState, useRef } from 'react'
import type { PalId, PalState } from '../lib/core'
import { active, running, countUp, isPaused, phaseLabel, remaining, DEFAULT_CONFIG, type StudyConfig, type Session } from '../lib/session'
import { METHODS, ToolGallery, ToolSetup, RhythmBand, StudyDialog } from './StudyTools'
import { Pal } from '../pals/Pal'
import Library, { type LibraryTarget } from './Library'
import type { Task } from '../lib/core'
import { listFolders, LIBRARY_EVENT, type Folder, type LibraryFile } from '../lib/library'

interface Props {
  setupConfig?: StudyConfig | null
  onSetupDone?: () => void
  session: Session
  pal: PalId
  palState: PalState
  todayMinutes: number
  /** The pal's latest line about the session, '' for none */
  palLine?: string
  alarmsOn: boolean
  onStart: () => void
  onConfigure: (c: StudyConfig) => void
  onNext: (minutes?: number) => void
  onRecover: (include: boolean) => void
  onBrowse: (id: string) => void
  browseFolderId?: string | null
  onBrowseDone?: () => void
  onPause: () => void
  onResume: () => void
  onSkip: () => void
  onStop: (done?: boolean) => void
  onEnableAlarms: () => void
  /** Library: reviewers and notes in folders */
  tasks: Task[]
  section: 'focus' | 'library'
  onSection: (s: 'focus' | 'library') => void
  libraryTarget?: LibraryTarget | null
  onLibraryTargetDone?: () => void
  onPlanFile: (file: LibraryFile, folder: Folder) => void
  onToast: (text: string) => void
  /** Desktop: the Focus/Library switch is in the panel's top bar, not here */
  tabsInHeader?: boolean
}

/** Focus / Library switch: inside Study on a phone, in the panel's top bar on a computer */
export function StudyTabs({ section, onSection }: { section: 'focus' | 'library'; onSection: (s: 'focus' | 'library') => void }) {
  return (
    <div className="inline-flex rounded-full bg-ink/[0.05] p-1" role="tablist" aria-label="Study">
      {(['library', 'focus'] as const).map((s) => (
        <button key={s} role="tab" aria-selected={section === s} type="button" onClick={() => onSection(s)} className={`press h-8 rounded-full px-4 text-[13px] ${section === s ? 'bg-paper font-medium shadow-sm' : 'text-ink-2'}`}>
          {s === 'focus' ? 'Focus' : 'Library'}
        </button>
      ))}
    </div>
  )
}

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Study: the focus timer, and the library of reviewers. The session lives in App so switching tabs never stops it. */
export function Study(props: Props) {
  const { section, onSection } = props
  const [screen, setScreen] = useState<'gallery' | 'workspace'>(() => active(props.session) ? 'workspace' : 'gallery')
  const wasActive = useRef(active(props.session))
  useEffect(() => { const current = active(props.session); if (current && !wasActive.current) setScreen('workspace'); wasActive.current = current }, [props.session.phase])
  const [pending, setPending] = useState<StudyConfig | null>(null)
  const configureTool = (c: StudyConfig) => { if (active(props.session)) setPending(c); else { props.onConfigure(c); setScreen('workspace'); onSection('focus') } }
  return (
    <div className="flex h-full flex-col">
      {!props.tabsInHeader && (
        <div className="flex shrink-0 justify-center px-4 pt-3">
          <StudyTabs section={section} onSection={onSection} />
        </div>
      )}
      <button className="press mx-4 mt-2 h-9 self-start rounded-full px-3 text-sm text-accent" hidden={!active(props.session)} onClick={() => { setScreen('workspace'); onSection('focus') }}>{isPaused(props.session) ? 'Focus paused' : props.session.phase === 'waiting' ? 'Next round ready' : 'Focus session active'}</button>
      {pending && <StudyDialog title="You already have a focus session" onClose={() => setPending(null)}><p className="mt-3 text-sm text-ink-2">Keep your current session, or finish it before preparing a new one.</p><button className="mt-5 h-11 w-full rounded-full bg-accent text-white dark:text-paper" onClick={() => { setPending(null); setScreen('workspace'); onSection('focus') }}>Resume current session</button><button className="mt-2 h-11 w-full rounded-full bg-paper-2" onClick={() => { props.onStop(); props.onConfigure(pending); setPending(null); setScreen('workspace'); onSection('focus') }}>Finish current and open new</button></StudyDialog>}
      <div className="min-h-0 flex-1">
        {section === 'focus' ? <Focus {...props} onConfigure={configureTool} screen={screen} onScreen={setScreen} /> : <Library pal={props.pal} tasks={props.tasks} now={Date.now()} target={props.libraryTarget} onTargetDone={props.onLibraryTargetDone} onPlan={props.onPlanFile} onToast={props.onToast} onStudy={configureTool} browseFolderId={props.browseFolderId} onBrowseDone={props.onBrowseDone} />}
      </div>
    </div>
  )
}

export function Focus(props: Props & { screen: 'gallery' | 'workspace'; onScreen: (screen: 'gallery' | 'workspace') => void }) {
  const { session, onConfigure, onStart, onPause, onResume, onSkip, onStop, onNext, onRecover } = props
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<ToolId | null>(() => props.setupConfig ? 'custom' : null), [now, setNow] = useState(Date.now()), [breakMinutes, setBreakMinutes] = useState(5)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { setBreakMinutes((session.breakMs ?? 300_000) / 60_000) }, [session.breakMs])
  const [folderExists, setFolderExists] = useState(true)
  useEffect(() => { let alive = true; const check = () => { if (!session.config?.folderId) { setFolderExists(true); return } void listFolders().then(folders => { if (alive) setFolderExists(folders.some(f => f.id === session.config?.folderId)) }).catch(() => { if (alive) setFolderExists(false) }) }; check(); window.addEventListener(LIBRARY_EVENT, check); return () => { alive = false; window.removeEventListener(LIBRARY_EVENT, check) } }, [session.config?.folderId])
  const config = session.config ?? DEFAULT_CONFIG
  const ready = session.phase === 'idle' || session.phase === 'ready', finished = session.phase === 'finished'
  const tool: ToolId = config.preparation === 'frog' ? 'frog' : config.method
  const toGallery = () => { props.onSetupDone?.(); setEditing(false); setChoice(null); props.onScreen('gallery') }
  const primary = 'press h-11 rounded-full bg-accent px-6 text-sm font-semibold text-white dark:text-paper'
  const secondary = 'press h-11 rounded-full bg-paper-2 px-5 text-sm text-ink'
  if (props.screen === 'gallery') return <div className="focus-scroll tool-container">{choice ? <ToolSetup key={choice} choice={choice} initialConfig={editing ? config : props.setupConfig ?? undefined} tasks={props.tasks} onBack={() => { setChoice(null); props.onSetupDone?.() }} onOpen={c => { setChoice(null); props.onSetupDone?.(); onConfigure(c) }}/> : <ToolGallery onSelect={tool => { setEditing(false); setChoice(tool) }} onContinue={active(session) ? () => props.onScreen('workspace') : undefined}/>}</div>
  const clock = mmss(finished ? session.completedFocusMs : session.phase === 'breakReady' ? session.breakMs ?? 300_000 : ready || session.phase === 'waiting' ? (config.method === 'flowtime' || config.method === 'task' ? 0 : config.method === '52-17' ? 52 : config.method === 'pomodoro' ? 25 : config.focusMinutes) * 60_000 : remaining(session, now))
  const duration = (session.phase === 'break' ? session.breakMs ? session.breakMs / 60_000 : config.method === 'pomodoro' ? session.round === 4 ? 15 : 5 : config.method === '52-17' ? 17 : config.breakMinutes : config.method === 'pomodoro' ? 25 : config.method === '52-17' ? 52 : config.focusMinutes) * 60_000
  const progress = !['focus', 'break'].includes(session.phase) || countUp(session) || !duration ? 0 : Math.max(0, Math.min(1, 1 - remaining(session, now) / duration))
  return <div className="focus-scroll tool-container">
    <section className="tool-workspace" data-workspace={tool}>
      <div className="tool-workspace-heading"><div><h2 className="text-[28px] font-semibold tracking-[-0.025em]">{METHODS[tool].name}</h2><p className="mt-1 text-sm text-ink-2">{config.folderName ?? 'Independent focus'}</p></div><button className="tool-back" onClick={toGallery}>← All tools</button></div>
      <p className="mt-4 text-sm text-ink-2" aria-live="polite">{ready ? 'Ready when you are' : isPaused(session) ? `${phaseLabel(session)} · paused` : phaseLabel(session)}</p>
      {config.goal && <p className={`tool-goal ${tool === 'task' || tool === 'frog' ? 'is-prominent' : ''}`}>{config.goal}</p>}
      <div className={`tool-scene scene-${tool}`}>
        {tool === 'pomodoro' ? <div className="pomodoro-dial"><ToolInstrument tool={tool} progress={progress} resting={session.phase === 'break'}/><span className="tool-time dial-time" role="timer" aria-live="off">{clock}</span></div> : <>
          {tool !== '52-17' && <ToolInstrument tool={tool}/>}
          <div className="tool-time-block">{tool === '52-17' && <RhythmBand resting={session.phase === 'break'}/>}<span className="tool-time" role="timer" aria-live="off">{clock}</span>{tool === 'custom' && <div className="custom-session-values"><span>{config.focusMinutes} min focus</span><span>{config.breakMinutes ? `${config.breakMinutes} min break` : 'No break'}</span><span>{config.rounds} round{config.rounds === 1 ? '' : 's'}</span>{ready && <button onClick={() => { setEditing(true); setChoice('custom'); props.onScreen('gallery') }} className="tool-back">Adjust timer</button>}</div>}<p className="mt-2 text-sm text-ink-2">{finished ? 'Focused time recorded' : session.phase === 'breakReady' ? 'Suggested break' : session.phase === 'waiting' ? 'Next focus block' : countUp(session) || ready && ['flowtime', 'task'].includes(config.method) ? 'Time focused' : 'Time remaining'}</p></div>
        </>}
      </div>
      {config.method === 'pomodoro' && <div className="tool-rounds" aria-label={`Round ${session.round} of four`}>{[1,2,3,4].map(n => <span key={n} className={n === session.round ? 'is-current' : n < session.round ? 'is-done' : ''}>{n}</span>)}</div>}

      {finished && <p className="mt-4 text-sm text-ink-2">Your task progress stays yours to decide.</p>}
      {session.awayAt !== undefined ? <div className="mt-5 rounded-[20px] bg-paper-2 p-4"><p className="font-medium">Were you still focusing while away?</p><div className="mt-3 flex flex-wrap justify-center gap-2"><button className={primary} onClick={() => onRecover(true)}>Include time away</button><button className={secondary} onClick={() => onRecover(false)}>Exclude time away</button></div></div> : <div className="mt-6 flex flex-wrap justify-center gap-2">
        {ready && <button className={primary} onClick={config.method === 'task' && !config.goal ? () => { setChoice('task'); props.onScreen('gallery') } : onStart}>Start</button>}
        {finished && <button className={primary} onClick={toGallery}>Choose another tool</button>}
        {running(session) && <button className={primary} onClick={onPause}>Pause</button>}
        {isPaused(session) && <button className={primary} onClick={onResume}>Resume</button>}
        {session.phase === 'waiting' && <button className={primary} onClick={() => onNext()}>Start next round</button>}
        {session.phase === 'breakReady' && <><label className="text-sm">Break minutes<input className="study-input mt-1 w-24" type="number" min={1} max={60} value={breakMinutes} onChange={e => setBreakMinutes(Number(e.target.value))} /></label><button className={primary} disabled={!Number.isFinite(breakMinutes) || breakMinutes < 1 || breakMinutes > 60} onClick={() => onNext(breakMinutes)}>Start break</button></>}
        {session.phase === 'focus' && config.method !== 'task' && (config.method !== 'custom' || config.breakMinutes > 0) && <button className={secondary} onClick={onSkip}>Take a break</button>}
        {session.phase === 'break' && <button className={secondary} onClick={onSkip}>Skip break</button>}
        {session.phase === 'focus' && config.method === 'task' && <button className={primary} onClick={() => onStop(true)}>Goal done</button>}
        {active(session) && <button className={secondary} onClick={() => onStop(false)}>{config.method === 'task' ? 'Finish for now' : 'Finish'}</button>}
      </div>}
      {config.folderId && <button className="press mt-3 h-11 rounded-full px-4 text-sm text-accent" disabled={!folderExists} title={!folderExists ? 'This folder is no longer available' : undefined} onClick={() => props.onBrowse(config.folderId!)}>{folderExists ? 'View materials' : 'Folder unavailable'}</button>}
      {!props.alarmsOn && <button className="press mt-3 h-11 rounded-full px-4 text-sm text-accent" onClick={props.onEnableAlarms}>Enable session alarms</button>}
      {props.palLine && <p className="mt-5 max-w-sm text-sm text-ink-2">{props.palLine}</p>}
      <div className="tool-companion"><Pal id={props.pal} state={props.palState} size={104} className="mt-5" /><p className="text-sm text-ink-2">One session at a time.</p></div>
      <p className="mt-3 text-sm text-ink-2">Today: {props.todayMinutes} min focused</p>
    </section>
  </div>
}
export default Study
