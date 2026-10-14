import React from 'react'
import CardPractice from '../../src/components/CardPractice'
import { createRoot } from 'react-dom/client'
import Welcome from '../../src/components/Welcome'
import App from '../../src/App'
import Settings from '../../src/components/Settings'
import { TimerPill } from '../../src/components/TimerPill'
import { BlockPopover, DeletePlansSheet, SyllabusSheet, Toasts } from '../../src/components/Overlays'
import { StudyDialog, ToolGallery } from '../../src/components/StudyTools'
import '../../src/index.css'
const noop = () => {}
const surface = new URLSearchParams(location.search).get('surface') ?? 'welcome'
const now = Date.now()
const event = { id: 'event', title: 'A long calendar plan with a detailed name for a small screen', kind: 'work' as const, status: 'planned' as const, start: now, end: now + 3600000, why: 'A useful explanation that should wrap inside the pop-up. '.repeat(20) }
const settings = { pal: 'rei' as const, name: 'Rei', energy: 'afternoon' as const, onboarded: true, voiceOn: false, notify: false, notifyAsked: true }
const surfaces: Record<string, React.ReactNode> = {
  welcome: <Welcome onDone={() => { document.body.dataset.completed = 'true' }} />,
  app: <App />,
  cards: <div className="folder h-dvh overflow-y-auto p-5" data-tone="class"><CardPractice file={{id:'fixture-file',folderId:'fixture-folder',name:'Definitions',kind:'text',size:40,blob:new Blob(['A: Alpha']),pages:['A: Alpha'],chunks:[{id:'chunk',page:1,text:'A: Alpha\nB: Beta'}],scanned:false,addedAt:now}} pal="rei"/></div>,
  syllabus: <SyllabusSheet now={now} onClose={noop} onAdd={noop} source={'A_very_long_course_handout_filename_'.repeat(5) + '.pdf'} initialText={Array.from({length:18}, (_,i)=>`Research paper ${i} due Nov 3`).join('\n')} />,
  delete: <DeletePlansSheet count={42} onClose={noop} onConfirm={noop} />,
  popover: <BlockPopover ev={event} rect={new DOMRect(innerWidth - 50, innerHeight - 30, 40, 20)} onClose={noop} onDone={noop} onAccept={noop} onDelete={noop} />,
  study: <StudyDialog title="Choose your focus tool" onClose={noop}><ToolGallery onSelect={noop} /></StudyDialog>,
  settings: <Settings settings={settings} onChange={noop} onClose={noop} dark={false} onTheme={noop} onEnableReminders={async()=>false} onSyllabus={noop} onDemoWeek={noop} onClearPrefs={noop} />,
  timers: <TimerPill timers={[1,2,3].map(i=>({id:String(i),label:`Timer ${i}`,endsAt:now+600000}))} ringing={null} onPause={noop} onResume={noop} onCancel={noop} onStop={noop} />,
  toast: <Toasts items={[{id:'notice',text:'A very long notice about your calendar and the next plan that needs your attention.',action:{label:'View plan',fn:noop}}]} dismiss={noop} />,
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{surfaces[surface]}</React.StrictMode>)
