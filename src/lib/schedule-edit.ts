import {uid,type CalEvent,type Kind} from './core'
export interface ScheduleDraft {title:string;kind:Kind;start:number;end:number;note:string;travel?:CalEvent['travel']}
export function validateScheduleDraft(d:ScheduleDraft):string[]{const errors:string[]=[];if(!d.title.trim()||d.title.length>240)errors.push('Enter a title of 1–240 characters.');if(!Number.isFinite(d.start)||!Number.isFinite(d.end)||d.end<d.start||(d.kind!=='deadline'&&d.end===d.start))errors.push('End must be after start.');if(d.note.length>20000)errors.push('Notes must be under 20,000 characters.');return errors}
export function applyScheduleEdit(before:CalEvent|null,draft:ScheduleDraft,latest:CalEvent[],allowOverlap:boolean){
 const errors=validateScheduleDraft(draft);if(errors.length)throw new Error(errors.join(' '))
 if(before&&JSON.stringify(latest.find(e=>e.id===before.id))!==JSON.stringify(before))throw new Error('This schedule changed. Reopen it to keep those changes.')
 const hits=latest.filter(e=>e.id!==before?.id&&e.kind!=='deadline'&&['planned','proposed'].includes(e.status)&&e.start<draft.end&&e.end>draft.start)
 if(hits.length&&!allowOverlap){const error=new Error(`Overlaps ${hits.map(e=>e.title).join(', ')}.`);error.name='ScheduleConflict';throw error}
 const event:CalEvent={...before,...draft,id:before?.id??uid(),title:draft.title.trim(),status:before?.status??'planned',...(draft.kind==='commute'?{transportSource:'user-trip' as const}:{})}
 return{events:before?latest.map(e=>e.id===before.id?event:e):[...latest,event],event}
}

import type {Task} from './core'
import {applyTaskEdit,syncTaskCalendar} from './tasks'
export function resolveEditorOriginal(editor:{event:CalEvent|null;isNew?:boolean},latest:CalEvent[]):CalEvent|null{
 if(editor.isNew||!editor.event)return null
 if(!latest.some(e=>e.id===editor.event!.id))throw new Error('This schedule changed or was deleted. Reopen it before saving.')
 return editor.event
}
export function synchronizeScheduleOwner(before:CalEvent|null,event:CalEvent,tasks:Task[],events:CalEvent[],now:number){
 const task=before?.taskId?tasks.find(t=>t.id===before.taskId):undefined
 if(!task||!(before!.kind==='deadline'||task.scheduled?.eventId===before!.id))return{tasks,events:before?events.map(e=>e.id===event.id?event:e):[...events,event]}
 const after=applyTaskEdit(task,{...task,title:event.title,notes:event.note??'',...(before!.kind==='deadline'?{due:event.start}:{scheduled:{eventId:event.id,start:event.start,end:event.end}})},now)
 return{tasks:tasks.map(t=>t.id===task.id?after:t),events:syncTaskCalendar(task,after,events)}
}
