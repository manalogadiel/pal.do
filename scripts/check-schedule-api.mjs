import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
const realFetch=globalThis.fetch
try {
 const {scheduleExtract}=await v.ssrLoadModule('/api/_lib/schedule-extract.ts')
 const req=(body,origin='http://localhost:8443')=>new Request('http://localhost:8443/api/schedule-extract',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
 assert.equal((await scheduleExtract(req({type:'text',content:'Bio MWF 9–10 AM'}),'' )).status,503)
 assert.equal((await scheduleExtract(req({type:'text',content:'Bio'},'https://evil.example'),'key')).status,403)
 assert.equal((await scheduleExtract(req({type:'text',content:'x'.repeat(100001)}),'key')).status,400)
 globalThis.fetch=async(url,options)=>{assert.match(url,/gemini-3\.1-flash-lite:generateContent/);const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({classes:[{title:'BIO 101',days:[1,3,5],startTime:'09:00',endTime:'10:00',room:null,instructor:null,sourceText:'BIO 101 MWF 9–10 AM',page:null,issues:[]}]})}]}}]})}
 const success=await scheduleExtract(req({type:'text',content:'Bio MWF 9–10 AM'}),'key');assert.equal(success.status,200);assert.equal((await success.json()).classes[0].title,'BIO 101')
 assert.equal((await scheduleExtract(req({type:'images',pages:[{mimeType:'image/png',data:'aGVsbG8=',page:2}]}),'key')).status,502,'PDF rows must retain their selected source page')
 globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'bad-json'}]}}]})
 assert.equal((await scheduleExtract(req({type:'text',content:'Bio'}),'key')).status,502)
 globalThis.fetch=async()=>{throw new DOMException('timeout','TimeoutError')}
 assert.equal((await scheduleExtract(req({type:'text',content:'Bio'}),'key')).status,504)
 assert.equal((await scheduleExtract(new Request('http://localhost:8443/api/schedule-extract',{method:'POST',body:'x'.repeat(4500001)}),'key')).status,413)
 const oldTimer=globalThis.setTimeout, oldUrl=process.env.UPSTASH_REDIS_REST_URL, oldToken=process.env.UPSTASH_REDIS_REST_TOKEN
 try {
  process.env.UPSTASH_REDIS_REST_URL='https://quota.example';process.env.UPSTASH_REDIS_REST_TOKEN='fixture'
  globalThis.setTimeout=(fn,delay,...args)=>oldTimer(fn,delay===30000?1:delay,...args)
  globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))
  const bounded=await Promise.race([scheduleExtract(req({type:'text',content:'Bio'}),'key'),new Promise((_,reject)=>oldTimer(()=>reject(new Error('Quota deadline missing')),100))]);assert.equal(bounded.status,504)
 }finally{globalThis.setTimeout=oldTimer;if(oldUrl===undefined)delete process.env.UPSTASH_REDIS_REST_URL;else process.env.UPSTASH_REDIS_REST_URL=oldUrl;if(oldToken===undefined)delete process.env.UPSTASH_REDIS_REST_TOKEN;else process.env.UPSTASH_REDIS_REST_TOKEN=oldToken}
 console.log('schedule API: CORS, credentials, limits, structured model request, invalid result and timeout pass')
}finally{globalThis.fetch=realFetch;await v.close()}
