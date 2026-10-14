import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import SelectField from '../../src/components/SelectField'
import {StudyDialog} from '../../src/components/StudyTools'
import '../../src/index.css'
function Fixture(){
 const [value,setValue]=useState('a'),[dialog,setDialog]=useState(true),[removed,setRemoved]=useState(false),[busy,setBusy]=useState(false),[submits,setSubmits]=useState(0)
 return <div className="p-5"><button onClick={()=>setDialog(true)}>Open dialog</button><output aria-label="Committed value">{value}</output><output aria-label="Submissions">{submits}</output>{dialog&&<StudyDialog title="Dropdown fixture" onClose={()=>setDialog(false)}><form onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}><label className="task-field mt-4">Category<SelectField aria-label="Category" value={value} disabled={busy} onValueChange={setValue} options={removed?[]:[{value:'a',label:'Alpha'},{value:'b',label:'Beta',disabled:true},{value:'c',label:'Chemistry with a sufficiently long name to verify wrapping on narrow screens'},...Array.from({length:20},(_,i)=>({value:String(i),label:`Subject ${i}`}))]}/></label><button type="button" className="tool-button-secondary mt-4" onClick={()=>setRemoved(!removed)}>Toggle options</button><button type="button" className="tool-button-secondary" onClick={()=>setBusy(!busy)}>Toggle busy</button><button type="button" className="tool-button-secondary" onClick={()=>setTimeout(()=>setRemoved(true),500)}>Refresh options shortly</button><button type="submit" className="tool-button-primary">Save</button></form></StudyDialog>}</div>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
