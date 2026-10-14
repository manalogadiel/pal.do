import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const s=await v.ssrLoadModule('/src/lib/session.ts')
 for(const method of ['flowtime','task']){
  const cfg={method,focusMinutes:0,breakMinutes:method==='task'?0:5,rounds:1,...(method==='task'?{goal:'Actual task'}:{})}
  assert.equal(s.validateConfig(cfg),true,`${method} must accept the count-up preset`)
  let session=s.start(1000,cfg);assert.equal(session.phase,'focus');assert.equal(s.tick(session,20000).phase,'focus');assert.equal(s.focusElapsed(session,11000),10000)
  session=s.pause(session,11000);assert.equal(s.focusElapsed(session,21000),10000);session=s.resume(session,21000);assert.equal(s.focusElapsed(session,26000),15000)
  assert.equal(s.finish(session,26000).completedFocusMs,15000)
 }
 assert.equal(s.validateConfig({method:'custom',focusMinutes:0,breakMinutes:0,rounds:1}),false)
 assert.equal(s.validateConfig({method:'task',focusMinutes:0,breakMinutes:0,rounds:1}),false)
 console.log('timer presets: count-up, pause/resume, finish, and invalid countdown/task validation pass')
}finally{await v.close()}
