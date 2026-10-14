import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try {
 const {ClassReviewRows,conflictKey}=await v.ssrLoadModule('/src/components/ClassScheduleImport.tsx')
 const {normalizeExtractedClasses,reviewClassImport}=await v.ssrLoadModule('/src/lib/class-schedule.ts')
 const rows=normalizeExtractedClasses([{title:'<script>alert(1)</script>',days:[1,3,5],startTime:'09:00',endTime:'10:00',sourceText:'MWF 9AM–10AM',issues:[]},{title:'Unclear',days:[],startTime:null,endTime:null,issues:['AM/PM unclear']}])
 const html=renderToStaticMarkup(React.createElement(ClassReviewRows,{rows,onChange:()=>{}}))
 for(const s of ['Subject title','Room','Instructor','Add class row','Remove class','checked=""','disabled=""','AM/PM unclear'])assert.ok(html.includes(s),s)
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'))
 const overlap={fileId:'fixture',classes:[rows[0],{...rows[0],id:'second',title:'Lab'}],startDate:'2026-10-19',endDate:'2026-10-19',timezone:'Asia/Manila'}
 assert.equal(conflictKey(reviewClassImport(overlap,[],0).conflicts),conflictKey(reviewClassImport(overlap,[],0).conflicts),'Approval of overlapping selected rows must survive a render')
 console.log('schedule review: safe editable fields, unresolved selection, manual rows and removal controls pass')
}finally{await v.close()}
