// Uses the configured server service, with synthetic fixtures only. No provider stubs or calendar writes.
import assert from 'node:assert/strict'
import {timetablePdf,timetableDocx} from './fixtures/schedule-fixtures.mjs'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--headless=new']})
try {
 const page=await browser.newPage()
 await page.addInitScript(()=>{localStorage.setItem('paldo.hf','off');localStorage.setItem('paldo.ai-mode','offline');window.Worker=class{postMessage(){}terminate(){}}})
 await page.goto(process.env.PREVIEW_URL||'http://localhost:8443',{waitUntil:'domcontentloaded'})
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1100;c.height=600;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,1100,600);x.fillStyle='black';x.font='32px Arial';x.fillText('Weekly school schedule',30,40);x.fillText('BIO 101 | MWF | 9 AM – 10 AM | Room 201',30,100);return c.toDataURL('image/jpeg').split(',')[1]})
 const fixtures=[['image','School.jpg',Buffer.from(image,'base64'),'image/jpeg'],['pdf','Ordinary.pdf',timetablePdf(null,1),'application/pdf'],['pdf','Scanned.pdf',timetablePdf(Buffer.from(image,'base64'),1),'application/pdf'],['docx','Timetable.docx',await timetableDocx(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]
 for(const [kind,name,buffer,mime] of fixtures){
  const result=await page.evaluate(async({kind,name,data,mime})=>{const {prepareScheduleFile}=await import('/src/lib/schedule-files.ts');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const source=await prepareScheduleFile({id:'live-fixture',name,kind,size:bytes.length,blob:new Blob([bytes],{type:mime}),pages:[],chunks:[],scanned:kind==='image',folderId:null,addedAt:Date.now()});const response=await fetch('/api/schedule-extract',{method:'POST',headers:{'Content-Type':'application/json','X-Pal-Device':'schedule-fixture-check'},body:JSON.stringify(source)});return{status:response.status,body:await response.json()}},{kind,name,data:buffer.toString('base64'),mime})
  if(result.status===503&&/not configured/i.test(result.body.error)){console.log('LIVE EXTRACTION NOT VERIFIED: GEMINI_API_KEY is not configured on the preview server. Local preparation and mock-provider regressions are separate checks.');break}
  assert.equal(result.status,200,`${name}: ${JSON.stringify(result.body)}`)
  const row=result.body.classes.find(c=>c.title==='BIO 101');assert.ok(row,`${name}: printed course code`);assert.deepEqual([...row.days].sort(),[1,3,5]);assert.equal(row.startTime,'09:00');assert.equal(row.endTime,'10:00');if(kind==='pdf')assert.equal(row.page,1)
  console.log(`Live Gemini extraction verified: ${name}`)
 }
}finally{await browser.close()}
