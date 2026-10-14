import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const origin = process.env.PREVIEW_URL || 'http://localhost:8443'
const browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--headless=new'] })
const failures = [], captures = process.env.CAPTURES_DIR || '.playwright-mcp/adaptive'
await mkdir(captures,{recursive:true})
const sizes = [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080],[844,390],[1280,500],[320,340]]
try {
 for (const [width,height] of sizes) {
  const page = await browser.newPage({viewport:{width,height},reducedMotion:'reduce'})
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => {
   const now=Date.now()
   localStorage.setItem('paldo.ai-mode','offline')
   localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'rei',name:'Rei',onboarded:true,voiceOn:false,notify:false,notifyAsked:true,energy:'afternoon',advancedMode:true},events:[{id:'test',title:'An unusually long calendar event title for responsive testing',kind:'protected',status:'planned',start:now+3600000,end:now+7200000}],tasks:[{id:'task',title:'Research assignment with a very long name for a narrow task row',kind:'assignment',due:now+86400000,hours:4,doneHours:0}],msgs:[],asked:[],alerted:[],log:{},offset:0}))
   window.Worker=class {postMessage(){} terminate(){}}
  })
  await page.route('**/*', r => {
   const url = new URL(r.request().url())
   return url.origin===origin && !/^\/(api|tts)(?:\/|$)/.test(url.pathname) ? r.continue() : r.fulfill({status:503,body:'{}',contentType:'application/json'})
  })
  const url = surface => `${origin}/scripts/fixtures/adaptive-ui.html?surface=${surface}`
  const fit = async (surface,selector) => {
   const result = await page.locator(selector).first().evaluate(e => {
    const r=e.getBoundingClientRect()
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}
   })
   if(result.x < -1 || result.y < -1 || result.right>width+1 || result.bottom>height+1 || result.scrollWidth>result.clientWidth+2) failures.push({size:`${width}x${height}`,surface,...result})
  }
  await page.goto(url('welcome'),{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Get started'}).waitFor()
  if (/study pals?/i.test(await page.locator('h1').innerText())) failures.push({size:`${width}x${height}`,surface:'welcome wording'})
  const shellWidth=await page.locator('header').evaluate(e=>e.getBoundingClientRect().width)
  if(width>=1024 && shellWidth<width*.7) failures.push({size:`${width}x${height}`,surface:'narrow desktop onboarding',shellWidth})
  const artFit=await page.locator('.welcome-intro-pal').first().evaluate(e=>{const box=e.getBoundingClientRect(),svg=e.querySelector('svg').getBoundingClientRect();return Math.abs(box.width-svg.width)<2&&Math.abs(box.height-svg.height)<2});assert.equal(artFit,true,'Pal SVG must fill its resized wrapper so shadows remain beneath its feet')
  if (width===390 || width===1440) await page.screenshot({path:`${captures}/welcome-${width}.png`})
  for(const name of ['Get started', 'Skip for now', /Continue with/, /Continue anyway|^Continue$/, /Skip for now|^Continue|Continue \(keeps installing\)/]) {
   await page.getByRole('button',{name}).last().click()
   await page.waitForTimeout(100)
   if(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) failures.push({size:`${width}x${height}`,surface:'welcome horizontal overflow'})
   const overflowing=await page.locator('main').evaluate(e=>e.scrollWidth>e.clientWidth+2)
   if(overflowing) failures.push({size:`${width}x${height}`,surface:'onboarding step content overflow',step:await page.locator('.welcome-screen').getAttribute('data-step')})
   const next=page.locator('main button').last()
   await next.scrollIntoViewIfNeeded()
   const r=await next.boundingBox()
   if(r.y<0 || r.y+r.height>height+1) failures.push({size:`${width}x${height}`,surface:'welcome action clipped'})
  }
  await page.getByRole('button',{name:/Start with/}).click()
  assert.equal(await page.locator('body').getAttribute('data-completed'),'true')
  if(process.env.ADAPTIVE_ONLY==='welcome') { await page.close(); continue }
  for(const [surface,selector] of [['syllabus','dialog'],['delete','dialog'],['popover','[role=dialog]'],['study','dialog'],['settings','dialog'],['toast','[aria-live]>div'],['timers','[role=timer]']]) {
   await page.goto(url(surface),{waitUntil:'domcontentloaded'})
   await page.locator(selector).first().waitFor()
   await page.waitForTimeout(150)
   await fit(surface,selector)
   if(['syllabus','delete','popover','study'].includes(surface)) {
    const action=page.locator(selector).first().getByRole('button').last()
    await action.scrollIntoViewIfNeeded()
    const r=await action.boundingBox()
    if(r.y<0 || r.y+r.height>height+1) failures.push({size:`${width}x${height}`,surface:`${surface} last action clipped`})
   }
   if(surface==='settings') {
    const count=await page.locator('[data-category]').count()
    for(let i=0;i<count;i++) {
     await page.locator('[data-category]').nth(i).click()
     await page.waitForTimeout(80)
     const content=page.locator('.settings-content')
     if(await content.evaluate(e=>e.scrollWidth>e.clientWidth+2)) failures.push({size:`${width}x${height}`,surface:`settings category ${i} overflow`})
     const back=page.getByRole('button',{name:'All settings',exact:true})
     if(await back.isVisible()) await back.click()
    }
   }
   if(surface==='popover' && width===1440) {
    await page.setViewportSize({width:320,height:340})
    await page.waitForTimeout(100)
    const clipped=await page.locator('[role=dialog]').evaluate(e=>{const r=e.getBoundingClientRect();return r.x<0||r.y<0||r.right>innerWidth+1||r.bottom>innerHeight+1})
    if(clipped) failures.push({size:'320x340',surface:'popover live resize'})
    await page.setViewportSize({width,height})
   }
   if((width===390 || width===1440) && surface==='syllabus') await page.screenshot({path:`${captures}/${surface}-${width}.png`})
  }

  await page.goto(url('app'),{waitUntil:'domcontentloaded'})
  for(const view of ['Today','Week','Block Yard','Study']) {
   await page.getByRole('navigation',{name:'Views'}).getByRole('button',{name:new RegExp('^'+view)}).click()
   await page.waitForTimeout(200)
   const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)
   if(horizontal) failures.push({size:`${width}x${height}`,surface:`${view} horizontal overflow`})
   const pane=await page.locator('.app-shell>main,.app-shell>section').boundingBox()
   if(pane.width<260) failures.push({size:`${width}x${height}`,surface:`${view} cramped panel`,pane})
   const overflow=await page.locator('.app-shell>main,.app-shell>section').evaluate(e=>e.scrollWidth>e.clientWidth+2)
   if(overflow) failures.push({size:`${width}x${height}`,surface:`${view} panel overflow`})
   if(width===390 || width===1440) await page.screenshot({path:`${captures}/${view.toLowerCase()}-${width}.png`})
  }
  if(width<1024) {
   await fit('closed chat','.chat-dock')
   await page.getByRole('textbox',{name:'Message'}).focus()
   await page.waitForTimeout(500)
   await fit('open chat','.chat-dock')
   if(width===390) {
    await page.setViewportSize({width,height:340})
    await page.waitForTimeout(250)
    const clipped=await page.locator('.chat-dock').evaluate(e=>e.getBoundingClientRect().bottom>innerHeight+1 || e.getBoundingClientRect().top<0)
    if(clipped) failures.push({size:'390x340',surface:'chat after height resize'})
    await page.setViewportSize({width,height})
   }
  }
  await page.close()
 }
 await writeFile(`${captures}/results.json`,JSON.stringify(failures,null,2))
 console.log(JSON.stringify(failures,null,2))
 assert.equal(failures.length,0,`${failures.length} adaptive layout failures`)
 console.log(process.env.ADAPTIVE_ONLY==='welcome' ? 'adaptive onboarding: all steps fit nine phone, tablet, desktop and landscape sizes' : 'adaptive UI: onboarding, main views, Settings sections and overlays fit nine screen sizes')
} finally {await browser.close()}
