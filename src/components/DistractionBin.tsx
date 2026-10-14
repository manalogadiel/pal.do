import {useRef,useState} from 'react'
import {Trash} from './Icons'
const KEY='paldo.pomodoro-distraction'
export default function DistractionBin(){
 const [draft,setDraft]=useState(()=>{try{return localStorage.getItem(KEY)??''}catch{return ''}}),[error,setError]=useState(''),[thrown,setThrown]=useState(false)
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 const write=(text:string)=>{setDraft(text);setError('');try{localStorage.setItem(KEY,text)}catch{setError('This draft could not be saved on this device.')}}
 const discard=()=>{try{localStorage.removeItem(KEY)}catch{setError('Could not remove the saved draft. Please try again.');return}setDraft('');setError('');setThrown(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setThrown(false),700)}
 return <aside className="distraction-bin folder" data-tone="sand"><div className="folder-face distraction-paper" data-pattern="lines" data-thrown={thrown}><label className="task-field">What’s distracting you?<textarea aria-label="What’s distracting you?" rows={4} maxLength={20000} value={draft} onChange={e=>write(e.target.value)} placeholder="Write it down, then let it go."/></label><button className="tool-button-secondary flex gap-2 items-center" disabled={!draft.trim()} onClick={discard}><Trash/>Throw away</button><p role="status" className="task-help mt-3">{thrown?'Thrown away. Back to your focus.':'Just for you. Throwing it away clears it from this device.'}</p>{error&&<p role="alert" className="task-error">{error}</p>}</div></aside>
}
