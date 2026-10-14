import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const origin=process.env.PREVIEW_URL||'http://localhost:8443'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--headless=new']})
try {
 for(const scenario of ['yung 2PM-4PM nalang','I choose the 2PM at the 4PM.','yung 2PM-2PM nalang','yes','stale']) {
  const answer=scenario==='stale'?'Use 2pm to 4pm':scenario
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'Asia/Manila'})
  page.setDefaultTimeout(10000)
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin&&!/^\/(api|tts)(?:\/|$)/.test(new URL(r.request().url()).pathname)?r.continue():r.fulfill({status:503,body:'{}',contentType:'application/json'}))
  await page.addInitScript((stale)=>{
   const now=new Date('2026-10-14T02:00:00Z').getTime(),at=h=>now+(h-10)*3600000
   const RealDate=Date
   window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
   const card={type:'event',title:'Workday Party',kind:'protected',start:at(17),end:at(19),conflicts:0,clash:['Mean dinner not deal, 4pm–6pm','Cafe shift, 6pm–10pm'],alt:{start:at(14),end:at(16)}}
   localStorage.setItem('paldo.ai-mode','offline')
   localStorage.setItem('paldo.view','home')
   localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'jhyvie',name:'Jhyvie',onboarded:true,voiceOn:false,notify:false,notifyAsked:true,energy:'afternoon',lastBrief:new Date().toDateString()},events:[{id:'dinner',title:'Mean dinner not deal',kind:'protected',start:at(16),end:at(18),status:'planned'},{id:'shift',title:'Cafe shift',kind:'shift',start:at(18),end:at(22),status:'planned'}],tasks:[],msgs:[{id:'offered',from:'pal',text:'2pm–4pm is free. Use that time instead?',card}],asked:[],alerted:[],log:{},offset:0,conversation:{intent:'event',title:card.title,kind:card.kind,day:at(0),start:card.start,end:card.end,rejected:[]}}))
   if(stale) {
    const saved=JSON.parse(localStorage.getItem('paldo-v1'))
    saved.events.push({id:'new',title:'New class',kind:'class',start:at(14),end:at(15),status:'planned'})
    localStorage.setItem('paldo-v1',JSON.stringify(saved))
   }
   window.Worker=class {postMessage(){}terminate(){}}
  },scenario==='stale')
  await page.goto(origin,{waitUntil:'domcontentloaded'})
  const input=page.getByRole('textbox',{name:'Message'})
  await input.fill(answer);await input.press('Enter')
  await page.waitForTimeout(1200)
  if(answer==='yung 2PM-2PM nalang') {
   const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('paldo-v1')))
   assert.equal(before.events.filter(e=>e.title==='Workday Party').length,0,'Invalid equal endpoints must not add anything')
   assert.ok(before.msgs.at(-1).text.includes('start at end'),'The invalid range must receive clarification')
   await page.getByRole('button',{name:'Use 2pm–4pm',exact:true}).click()
   await page.waitForTimeout(500)
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('paldo-v1')))
  const added=saved.events.filter(e=>e.title==='Workday Party')
  if(scenario==='stale') {
   assert.equal(added.length,0,'A newly occupied alternative must not be added')
   assert.equal(saved.msgs.at(-1).card?.start,Date.parse('2026-10-14T06:00:00Z'))
   assert.ok(saved.msgs.at(-1).card?.clash.some(c=>c.includes('New class')))
   assert.ok(!saved.msgs.some(m=>m.from==='pal' && /Added|Nailagay|Nadagdag/i.test(m.text)))
   await page.close(); continue
  }
  assert.equal(added.length,1,`${answer}: selecting the suggestion must add one event instead of another overlap card`)
  assert.equal(new Date(added[0].start).getUTCHours(),6)
  assert.equal(new Date(added[0].end).getUTCHours(),8)
  const dinner=saved.events.find(e=>e.id==='dinner'),shift=saved.events.find(e=>e.id==='shift')
  assert.equal(dinner.start,Date.parse('2026-10-14T08:00:00Z'))
  assert.equal(dinner.end,Date.parse('2026-10-14T10:00:00Z'))
  assert.equal(shift.start,Date.parse('2026-10-14T10:00:00Z'))
  assert.equal(shift.end,Date.parse('2026-10-14T14:00:00Z'))
  assert.ok(saved.msgs.find(m=>m.id==='offered').resolved)
  assert.equal(saved.msgs.filter(m=>m.card?.type==='event'&&!m.resolved).length,0)
  await page.close()
 }
 console.log('event choice UI: typed/voice-style selection, equal-endpoint clarification, and plain yes add 2–4 PM once; existing events stay unchanged and stale slots are rechecked')
}finally{await browser.close()}
