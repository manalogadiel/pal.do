import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ToolInstrument, type ToolId } from './ToolInstrument'
import { DEFAULT_CONFIG, validateConfig, type Method, type StudyConfig } from '../lib/session'
import type { Task } from '../lib/core'
import { fmtDay } from '../lib/core'
export const METHODS: Record<Method | 'frog', { name: string; description: string }> = {
  pomodoro: { name: 'Pomodoro', description: '25 minutes focused. Short breaks. Four rounds.' },
  flowtime: { name: 'Flowtime', description: 'Follow your focus. Take a break when ready.' },
  task: { name: 'Task-based', description: 'Set a goal. Track the time it actually takes.' },
  '52-17': { name: '52 / 17', description: 'A longer focus block, then a proper rest.' },
  custom: { name: 'Custom timer', description: 'Your duration, breaks, and number of rounds.' },
  frog: { name: 'Eat the Frog', description: 'Choose the task you have been putting off.' },
}
export function StudyDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { ref.current?.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); else { const label = previous?.getAttribute('aria-label'); const text = previous?.textContent; const target = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => label ? b.getAttribute('aria-label') === label : b.textContent === text); target?.focus() } }) } }, [])
  return createPortal(<dialog ref={ref} className="study-dialog liquid-solid text-ink" onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-labelledby="study-dialog-title"><header className="flex items-center justify-between gap-4"><h2 id="study-dialog-title" className="text-xl font-semibold">{title}</h2><button className="press size-11 rounded-full hover:bg-paper-2" onClick={onClose} aria-label="Close study setup">×</button></header>{children}</dialog>, document.body)
}
export function ToolGallery({ onSelect, onContinue, onBrowse, context }: { onSelect: (tool: ToolId) => void; onContinue?: () => void; onBrowse?: () => void; context?: string }) {
  return <div className="tool-gallery-shell">
    <div className="tool-gallery-heading"><div><h2 className="text-[28px] font-semibold tracking-[-0.025em]">Choose your focus tool</h2><p className="mt-2 text-sm text-ink-2">{context ? `A little focus for ${context}.` : 'Find a rhythm for what you want to do.'} You choose when to start.</p></div>{onContinue && <button className="tool-button-primary shrink-0" onClick={onContinue}>Continue session</button>}</div>
    <div className="tool-gallery">{(Object.keys(METHODS) as ToolId[]).map(tool => <button key={tool} className="tool-tile press" onClick={() => onSelect(tool)}><div className="tool-tile-art"><ToolInstrument tool={tool}/></div><span className="block text-lg font-semibold">{METHODS[tool].name}</span><span className="mt-1 block text-sm leading-relaxed text-ink-2">{METHODS[tool].description}</span></button>)}</div>
    {onBrowse && <button className="tool-button-secondary mt-5" onClick={onBrowse}>Browse files</button>}
  </div>
}
function defaultsFor(tool: ToolId): StudyConfig {
  let saved: StudyConfig | undefined
  try { const candidate = JSON.parse(localStorage.getItem('paldo.studyDefaults') || 'null'); if (validateConfig(candidate)) saved = candidate } catch {}
  if (tool === 'custom') return saved?.method === 'custom' ? { ...saved } : { ...DEFAULT_CONFIG, method: 'custom', focusMinutes: 30, breakMinutes: 0, rounds: 1 }
  return { ...DEFAULT_CONFIG, method: tool === 'frog' ? 'pomodoro' : tool, goal: '', taskId: undefined, preparation: tool === 'frog' ? 'frog' : undefined }
}
export function ToolSetup({ choice, folder, tasks, onBack, onOpen, initialConfig }: { initialConfig?: StudyConfig; choice: ToolId; folder?: { id: string; name: string }; tasks: Task[]; onBack: () => void; onOpen: (config: StudyConfig) => void }) {
  const [config, setConfig] = useState<StudyConfig>(() => ({ ...(initialConfig ?? defaultsFor(choice)), folderId: folder?.id ?? initialConfig?.folderId, folderName: folder?.name ?? initialConfig?.folderName }))
  const [frogTimer, setFrogTimer] = useState<Method | null>(null)
  const requiredGoal = choice === 'frog' || choice === 'task'
  const valid = validateConfig(config) && (choice !== 'frog' || frogTimer !== null)
  const open = () => {
    if (!valid) return
    try { localStorage.setItem('paldo.studyDefaults', JSON.stringify({ ...config, folderId: undefined, folderName: undefined, taskId: undefined, goal: '' })) } catch {}
    onOpen(config)
  }
  return <div className="tool-setup" data-setup={choice}>
    <button className="tool-back" onClick={onBack}>← All tools</button>
    <div className="tool-setup-layout">
      <div className="tool-setup-preview"><ToolInstrument tool={choice}/><h2 className="text-[28px] font-semibold tracking-[-0.025em]">{METHODS[choice].name}</h2><p className="mt-2 text-sm leading-relaxed text-ink-2">{METHODS[choice].description}</p>{config.folderName && <p className="mt-4 text-sm font-medium">{config.folderName}</p>}
        {choice === 'pomodoro' && <div className="tool-rounds mt-5" aria-label="Four focus rounds">{[1,2,3,4].map(n=><span key={n}>{n}</span>)}</div>}
        {choice === '52-17' && <RhythmBand/>}
        {choice === 'custom' && <p className="mt-5 text-sm font-medium">{config.focusMinutes} min focus · {config.breakMinutes ? `${config.breakMinutes} min rest` : 'No break'} · {config.rounds} round{config.rounds===1?'':'s'}</p>}
        {choice === 'flowtime' && <p className="mt-5 text-sm text-ink-2">An elapsed clock, with no fixed finish line.</p>}
      </div>
      <form className="tool-setup-form" onSubmit={e=>{e.preventDefault();open()}}>
        <h3 className="text-lg font-semibold">{choice === 'frog' ? 'Pick your one important task' : 'Make room for focus'}</h3>
        <label className="mt-5 block text-sm font-medium">{requiredGoal ? 'Your goal (required)' : 'Your goal (optional)'}<input autoFocus className="study-input mt-2" maxLength={240} value={config.goal ?? ''} onChange={e=>setConfig(c=>({...c,goal:e.target.value,taskId:undefined}))} placeholder="For example, finish ten practice problems"/></label>
        {requiredGoal && <label className="mt-4 block text-sm">Or choose an existing task<select className="study-input mt-2" value={config.taskId ?? ''} onChange={e=>{const task=tasks.find(t=>t.id===e.target.value);setConfig(c=>({...c,taskId:task?.id,goal:task?.title??''}))}}><option value="">Write my own goal</option>{tasks.filter(t=>t.doneHours<t.hours).map(t=><option key={t.id} value={t.id}>{t.title} · {fmtDay(t.due)}</option>)}</select></label>}
        {choice === 'frog' && <fieldset className="mt-5"><legend className="text-sm font-medium">Choose your timer</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{(['pomodoro','task'] as const).map(method=><label key={method} className={`frog-timer-choice ${frogTimer===method?'is-selected':''}`}><input type="radio" name="frog-timer" checked={frogTimer===method} onChange={()=>{setFrogTimer(method);setConfig(c=>({...c,method}))}}/><span>{method==='pomodoro'?'Pomodoro timer':'Task-based timer'}</span></label>)}</div></fieldset>}
        {choice === 'custom' && <div className="custom-controls mt-5">{([['focusMinutes','Focus minutes',1,180],['breakMinutes','Break minutes',0,60],['rounds','Rounds',1,8]] as const).map(([key,label,min,max])=><label className="text-sm" key={key}>{label}<input className="study-input mt-2" type="number" min={min} max={max} value={config[key]} onChange={e=>setConfig(c=>({...c,[key]:Number(e.target.value)}))}/></label>)}</div>}
        {choice==='flowtime'&&<p className="mt-5 text-sm leading-relaxed text-ink-2">Work until you want to rest. You can adjust the suggested break when you get there.</p>}
        <button disabled={!valid} type="submit" className="tool-button-primary mt-6 w-full">Open timer</button><p className="mt-3 text-sm text-ink-2">Your clock stays ready until you press Start.</p>
      </form>
    </div>
  </div>
}
export function RhythmBand({ resting = false }: { resting?: boolean }) {
  return <div className="rhythm-band" aria-label="52 minutes focus, 17 minutes rest"><span className={!resting?'is-current':''}>52 focus</span><span className={resting?'is-current':''}>17 rest</span></div>
}
export function ToolChooser({ folder, tasks, onClose, onOpen, onBrowse }: { folder?: { id: string; name: string }; tasks: Task[]; onClose: () => void; onOpen: (c: StudyConfig) => void; onBrowse?: () => void }) {
  const [choice,setChoice]=useState<ToolId|null>(null)
  return <StudyDialog title={folder?`Study ${folder.name}`:'Choose your focus tool'} onClose={onClose}>{choice?<ToolSetup key={choice} choice={choice} folder={folder} tasks={tasks} onBack={()=>setChoice(null)} onOpen={onOpen}/>:<ToolGallery context={folder?.name} onSelect={setChoice} onBrowse={onBrowse}/>}</StudyDialog>
}
