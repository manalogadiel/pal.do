const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
import assert from 'node:assert/strict'
const origin = process.env.PREVIEW_URL || 'http://localhost:8443'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--headless=new'] })
try {
 const page = await browser.newPage()
 let errors = 0; page.on('pageerror', e => { if (++errors < 3) console.error(e.stack) })
 await page.goto(origin + '/scripts/fixtures/voice-chat.html', {waitUntil:'domcontentloaded',timeout:15000})
 await page.waitForSelector('[role=log]')
 const gap = () => page.locator('[role=log]').evaluate(e => e.scrollHeight-e.scrollTop-e.clientHeight)
 await page.waitForTimeout(600)
 assert.ok(await gap() < 3, 'Initially at bottom')
 await page.evaluate(() => window.updateChat({msgs:window.chatMessages.map((m,i)=>i===23?{...m,text:'New streamed content. '.repeat(180)}:m)}))
 await page.waitForTimeout(450)
 assert.ok(await gap() < 3, 'Growing the existing last message must keep the newest words visible')
 await page.evaluate(() => window.updateChat({micOn:true,interim:'May plano ako bukas sa mall.'}))
 await page.waitForTimeout(450)
 assert.ok(await gap() < 3, 'Opening the voice composer must keep the bottom visible')
 assert.ok(await page.getByText('May plano ako bukas sa mall.', {exact:true}).isVisible(), 'Live transcript visible')
 await page.evaluate(() => document.querySelector('#chat-box').style.height='400px')
 await page.waitForTimeout(450)
 assert.ok(await gap() < 3, 'Viewport/composer resizing must preserve the bottom')
 await page.locator('[role=log]').evaluate(e => e.scrollTop=0)
 await page.waitForTimeout(100)
 await page.evaluate(() => window.updateChat({msgs:window.chatMessages.map((m,i)=>i===23?{...m,text:'Another reply. '.repeat(200)}:m)}))
 await page.waitForTimeout(150)
 assert.equal(await page.locator('[role=log]').evaluate(e => e.scrollTop), 0, 'Reading older messages must not yank the scroll to the bottom')
 console.log('chat UI: streaming content, voice transcript, composer and viewport resize pass')

 const app = await browser.newPage()
 app.setDefaultTimeout(10000)
 await app.route('**/*', route => {
   const url = new URL(route.request().url())
   if (url.origin === origin && !/^\/(api|tts|audio)(?:\/|$)/.test(url.pathname)) return route.continue()
   return route.fulfill({ status:503, contentType:'application/json', body:'{}' })
 })
 await app.addInitScript(() => {
   localStorage.setItem('paldo.ai-mode','offline')
   localStorage.setItem('paldo.view','calendar')
   localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'jhyvie',name:'Jhyvie',onboarded:true,voiceOn:false,notify:false,notifyAsked:true,energy:'afternoon'},events:[],tasks:[],msgs:[],asked:[],alerted:[],log:{},offset:0,conversation:{intent:'event',title:'Water plant',kind:'protected',rejected:[]}}))
   // External recognizer/microphone boundaries only; the app handlers run unchanged.
   window.recognizers=[]
   class Recognizer {
     start(){window.recognizers.push(this);queueMicrotask(()=>this.onstart?.())}
     stop(){this.onend?.()}
     abort(){this.onend?.()}
   }
   window.SpeechRecognition=Recognizer
   navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[]})
   window.Worker=class {postMessage(){} terminate(){}}
 })
 await app.goto(origin, {waitUntil:'domcontentloaded'})
 await app.getByRole('textbox',{name:'Message'}).waitFor()
 await app.evaluate(()=>window.__palHandsFreeNoMic())
 const send = async text => { await app.getByRole('textbox',{name:'Message'}).fill(text); await app.getByRole('textbox',{name:'Message'}).press('Enter') }
 await send('i have a plan today')
 await app.waitForFunction(()=>JSON.parse(localStorage.getItem('paldo-v1')).conversation.title===undefined)
 await send('ang title nito ay Pagshoshopping, 3pm to 5pm ito')
 await app.getByRole('log').getByText('Pagshoshopping',{exact:true}).waitFor()
 assert.equal(await app.getByRole('log').getByText('Water plant',{exact:true}).count(),0,'The event card must use the supplied title')
 await app.getByRole('button',{name:'Switch to voice mode'}).click()
 await app.getByRole('button',{name:/Hands-free:|Tap or hold to talk/}).click()
 await app.waitForFunction(()=>window.recognizers.length===1)
 assert.equal(await app.evaluate(()=>window.recognizers[0].lang),'fil-PH','Jhyvie requests use Filipino browser recognition')
 await app.evaluate(()=>window.recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'May plano ako bukas',confidence:0.9}],{isFinal:false})]}))
 await app.getByText('May plano ako bukas',{exact:true}).first().waitFor()
 await app.evaluate(()=>window.recognizers[0].stop())
 await app.locator('[data-from=me]').filter({hasText:'May plano ako bukas'}).waitFor()
 await app.evaluate(()=>window.__palHear('hi jhyvie'))
 await app.waitForFunction(()=>window.recognizers.length===2)
 console.log('app voice: exact plan card, Filipino recognizer, visible partial transcript, partial-only submission, and wake after manual capture pass')
} finally { await browser.close() }