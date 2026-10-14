import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--headless=new']})
try{
 for(const fallback of [false,true]){
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(7000)
 if(fallback)await page.addInitScript(()=>{HTMLElement.prototype.showPopover=undefined})
 await page.goto('http://localhost:8443/scripts/fixtures/select-field.html',{waitUntil:'domcontentloaded'})
 const field=page.getByRole('combobox',{name:'Category'}),value=page.getByLabel('Committed value')
 await field.focus();await field.press('ArrowDown');await page.getByRole('listbox').waitFor();await field.press('ArrowDown');assert.ok((await field.getAttribute('aria-activedescendant')).endsWith('option-2'));await field.press('Escape');assert.equal(await value.innerText(),'a');assert.equal(await page.locator('dialog').count(),1)
 await field.press('c');await field.press('Enter');assert.equal(await value.innerText(),'c');assert.equal(await page.getByLabel('Submissions').innerText(),'0')
 await field.press('Home');await field.press('Enter');assert.equal(await value.innerText(),'a','Closed Home must select the first enabled option');await field.press('c');await field.press('Enter')
 await field.press('End');await field.press('Enter');assert.equal(await value.innerText(),'19','Closed End must select the last enabled option');await field.press('c');await field.press('Enter')
 await field.click();await page.getByRole('option',{name:'Beta',exact:true}).click({force:true});assert.equal(await value.innerText(),'c');await page.getByRole('option',{name:'Alpha',exact:true}).click();assert.equal(await value.innerText(),'a')
 // Padding inside the dialog is not the backdrop.
 await page.locator('dialog').click({position:{x:3,y:3}});assert.equal(await page.locator('dialog').count(),1,'Clicking inside dialog padding must keep it open')
 for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900],[1280,500]]){await page.setViewportSize({width,height});await field.scrollIntoViewIfNeeded();await field.click();const fit=await page.getByRole('listbox').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1});assert.equal(fit,true,`${width}x${height} fallback=${fallback}`);if(width===390||width===1440)await page.screenshot({path:`/tmp/paldo-dropdown-${width}-${fallback}.png`});await field.press('Escape')}
 await page.getByRole('button',{name:'Toggle busy'}).click();assert.equal(await field.isDisabled(),true);await page.getByRole('button',{name:'Toggle busy'}).click();await page.getByRole('button',{name:'Toggle options'}).click();assert.equal(await field.isDisabled(),true)
 await page.getByRole('button',{name:'Toggle options'}).click();await page.getByRole('button',{name:'Refresh options shortly'}).click();await field.click();await page.getByRole('listbox').waitFor();await page.getByRole('listbox').waitFor({state:'detached'});assert.equal(await value.innerText(),'a');assert.equal(await field.isDisabled(),true)
 await page.close()
 }
 const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'})
 await touch.goto('http://localhost:8443/scripts/fixtures/select-field.html',{waitUntil:'domcontentloaded'});await touch.getByRole('combobox',{name:'Category'}).tap();await touch.getByRole('option',{name:/^Chemistry/}).tap();assert.equal(await touch.getByLabel('Committed value').innerText(),'c')
 await touch.evaluate(()=>document.documentElement.classList.add('dark'));await touch.getByRole('combobox',{name:'Category'}).tap();const color=await touch.getByRole('listbox').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(color,'rgb(11, 20, 36)');await touch.screenshot({path:'/tmp/paldo-dropdown-dark-touch.png'});await touch.getByRole('combobox',{name:'Category'}).press('Escape')
 const cdp=await touch.context().newCDPSession(touch);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.25});await touch.waitForTimeout(100);await touch.getByRole('combobox',{name:'Category'}).tap();assert.equal(await touch.getByRole('listbox').evaluate(el=>{const r=el.getBoundingClientRect(),v=visualViewport;return r.left>=v.offsetLeft-1&&r.top>=v.offsetTop-1&&r.right<=v.offsetLeft+v.width+1&&r.bottom<=v.offsetTop+v.height+1}),true,'Popup fits the zoomed visual viewport');await touch.close()
 console.log('dropdown: keyboard commit/cancel, disabled options, form safety, modal padding, viewport bounds and popover fallback pass')
}finally{await browser.close()}
