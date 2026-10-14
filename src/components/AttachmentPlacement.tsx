import SelectField from './SelectField'
import {useState} from 'react'
import {StudyDialog} from './StudyTools'
import type {Folder} from '../lib/library'
export type AttachmentDestination={kind:'folder';folderId:string}|{kind:'new-folder';name:string}|{kind:'chat'}
export function PlacementContent({files,folders,onChoose,onCancel,onBusyChange}:{onBusyChange?:(busy:boolean)=>void;files:{name:string}[];folders:Folder[];onChoose:(destination:AttachmentDestination)=>Promise<void>;onCancel:()=>void}){
 const [choice,setChoice]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const choose=async(destination:AttachmentDestination)=>{if(busy)return;setBusy(true);onBusyChange?.(true);setError('');try{await onChoose(destination)}catch(e){setError((e as Error).message)}finally{setBusy(false);onBusyChange?.(false)}}
 return <div><p className="mt-3 text-sm text-ink-2 break-words">{files.map(f=>f.name).join(', ')}</p><p className="mt-3 text-sm">{folders.length?'Which folder should it go in?':'You have no folders yet. Create one, or keep this attachment in chat.'}</p>
 {folders.length>0&&<label className="task-field mt-5">Choose a folder<SelectField aria-label="Choose a folder" disabled={busy} value={choice} onValueChange={setChoice} options={[{value:'',label:'Choose a folder'},...folders.map(f=>({value:f.id,label:f.name}))]} /></label>}
 {choice==='new'&&<label className="task-field mt-4">Folder name<input autoFocus value={name} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)}/></label>}
 <div className="flex flex-wrap gap-2 mt-5">{choice&&choice!=='new'&&<button className="tool-button-primary" disabled={busy} onClick={()=>void choose({kind:'folder',folderId:choice})}>Save in folder</button>}{choice==='new'?<button className="tool-button-primary" disabled={busy||!name.trim()} onClick={()=>void choose({kind:'new-folder',name:name.trim()})}>Create and save</button>:<button className="tool-button-secondary" disabled={busy} onClick={()=>setChoice('new')}>Create folder</button>}<button className="tool-button-secondary" disabled={busy} onClick={()=>void choose({kind:'chat'})}>Keep in chat</button><button className="tool-button-secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>{busy&&<p role="status" className="mt-3">Saving attachment…</p>}{error&&<p className="task-error mt-4" role="alert">{error}</p>}
 </div>
}

export default function AttachmentPlacement(props:Parameters<typeof PlacementContent>[0]){const [busy,setBusy]=useState(false);return <StudyDialog title="Save this file in a folder?" onClose={()=>{if(!busy)props.onCancel()}}><PlacementContent {...props} onBusyChange={setBusy}/></StudyDialog>}
