import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const {normalizeExtractedClasses,expandClassSchedule,reviewClassImport,defaultClassDateRange}=await v.ssrLoadModule('/src/lib/class-schedule.ts')
 const now=Date.parse('2026-10-14T02:00:00Z')
 assert.deepEqual(defaultClassDateRange(now,'Asia/Manila'),{startDate:'2026-10-14',endDate:'2026-12-08'})
 const rows=normalizeExtractedClasses([{title:'BIO 101',days:[1,3,5],startTime:'09:00',endTime:'10:00',room:'201',sourceText:'BIO 101 MWF 9–10 AM',issues:[]}])
 assert.equal(rows[0].selected,true)
 const printedTitle='Course name '.repeat(55).trim();assert.equal(normalizeExtractedClasses([{...rows[0],title:printedTitle}])[0].title,printedTitle,'Printed subject names must not be truncated')
 const unknown=normalizeExtractedClasses([{title:'Math',days:[],startTime:null,endTime:null,sourceText:'Math T 7–8',issues:['Unclear weekday and AM/PM']}])
 assert.equal(unknown[0].selected,false);assert.ok(unknown[0].issues.length)
 const draft={fileId:'file',classes:rows,...defaultClassDateRange(now,'Asia/Manila'),timezone:'Asia/Manila'}
 const events=expandClassSchedule(draft,now);assert.equal(events.length,23);assert.equal(events[0].kind,'class');assert.ok(events.every(e=>e.start>now&&e.note.includes('201')))
 const review=reviewClassImport(draft,[events[0]],now);assert.equal(review.duplicates,1);assert.equal(review.events.length,22)
 assert.equal(reviewClassImport(draft,[{...events[0],kind:'protected'}],now).duplicates,1,'Exact existing calendar entries are duplicates even if their category was set manually')
 const conflict={...events[0],id:'different',title:'Shift',kind:'shift'}
 assert.ok(reviewClassImport(draft,[conflict],now).conflicts.length)
 assert.throws(()=>expandClassSchedule({...draft,classes:[{...rows[0],endTime:'08:00'}]},now),/end/i)
 assert.equal(reviewClassImport({...draft,classes:[]},[],now).events.length,0)
 const boundary=expandClassSchedule({...draft,startDate:'2026-10-14',endDate:'2026-10-14',classes:[{...rows[0],startTime:'11:00',endTime:'12:00'}]},now)
 assert.equal(boundary[0].start,Date.parse('2026-10-14T03:00:00Z'))
 assert.equal(defaultClassDateRange(now,'America/New_York').startDate,'2026-10-13')
 assert.equal(expandClassSchedule({...draft,timezone:'America/New_York',startDate:'2026-10-14',endDate:'2026-10-14',classes:[{...rows[0],startTime:'11:00',endTime:'12:00'}]},now)[0].start,Date.parse('2026-10-14T15:00:00Z'))
 assert.throws(()=>normalizeExtractedClasses({classes:'bad'}),/invalid/i)
 assert.equal(unknown[0].sourceText,'Math T 7–8')
 console.log('class schedules: timezone/eight-week expansion, unresolved fields, duplicates, conflicts, notes and invalid ranges pass')
}finally{await v.close()}
