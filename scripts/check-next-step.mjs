import { createServer } from 'vite'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const server=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try {
 const {bestNextStep}=await server.ssrLoadModule('/src/lib/next-step.ts')
 const now=new Date(2026,9,14,16).getTime(),min=60000
 const task={id:'paper',title:'Rizal reflection paper',due:now+86400000,hours:3,doneHours:1,kind:'assignment'}
 const event={id:'shift',title:'Café shift',start:now+45*min,end:now+180*min,kind:'shift',status:'planned'}
 const pick=bestNextStep(now,[event],[task]);assert.equal(pick.minutes,25);assert.equal(pick.availableMinutes,45);assert.equal(pick.task.id,'paper')
 assert.equal(bestNextStep(now,[{...event,start:now-10*min}],[task]),null,'No recommendation during an event')
 assert.equal(bestNextStep(now,[{...event,start:now+10*min}],[task]),null,'No recommendation in a short gap')
 assert.equal(bestNextStep(now,[],[{...task,doneHours:3}]),null,'Completed tasks excluded')
 assert.equal(bestNextStep(now,[],[task],{blockedDays:[new Date(now).getDay()]}),null,'Respect rest days')
 assert.equal(bestNextStep(now,[],[task],{latestHour:15}),null,'Respect latest study hour')
 assert.equal(bestNextStep(new Date(2026,9,14,2).getTime(),[],[task]),null,'Quiet hours excluded')
 assert.equal(bestNextStep(now,[],[task,{...task,id:'urgent',due:now+3600000}]).task.id,'urgent','Nearest deadline first')
 assert.equal(bestNextStep(now,[{...event,start:now-20*min,end:now-5*min,kind:'commute'}],[task]),null,'Respect post-commute buffer')
 assert.equal(bestNextStep(now,[{...event,status:'proposed',start:now-5*min}],[task]).minutes,25,'Proposals do not occupy time')
 const {Today}=await server.ssrLoadModule('/src/components/Today.tsx')
 const noop=()=>{}, props={now,events:[event],tasks:[task],pal:'rei',palState:'idle',onPoke:noop,onOpen:noop,onPlan:noop,onWeek:noop,onTasks:noop,onPrepare:noop}
 const html=renderToStaticMarkup(React.createElement(Today,props))
 assert.ok(html.includes('Best next step') && html.includes('Prepare focus session'))
 assert.ok(!renderToStaticMarkup(React.createElement(Today,{...props,focusActive:true})).includes('Best next step'),'Active session suppresses suggestion')
 const {Study}=await server.ssrLoadModule('/src/components/Study.tsx')
 const setupConfig={method:'custom',focusMinutes:25,breakMinutes:0,rounds:1,goal:task.title,taskId:task.id}
 const prepared=renderToStaticMarkup(React.createElement(Study,{session:{phase:'idle'},setupConfig,tasks:[task],pal:'rei',palState:'idle',todayMinutes:0,alarmsOn:true,section:'focus',onSection:noop,tabsInHeader:true}))
 assert.ok(prepared.includes('data-setup="custom"') && prepared.includes('Rizal reflection paper') && prepared.includes('Open timer') && !prepared.includes('>Pause<'),'Recommendation opens prefilled setup without starting')
 console.log('next step: deadline priority, actual gaps, quiet hours, preferences, and buffers pass')
} finally{await server.close()}
