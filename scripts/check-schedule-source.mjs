import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try {
 const {supportedScheduleFile,validateScheduleSource}=await v.ssrLoadModule('/src/lib/schedule-source.ts')
 for(const name of ['school.png','school.jpg','school.webp','school.pdf','school.docx']) assert.equal(supportedScheduleFile({name,blob:{type:''}}),true)
 for(const name of ['school.doc','school.docm','school.xls','school.txt','school.gif']) assert.equal(supportedScheduleFile({name,blob:{type:''}}),false)
 assert.throws(()=>validateScheduleSource({type:'text',content:'x'.repeat(100001)}),/smaller/i)
 assert.throws(()=>validateScheduleSource({type:'images',pages:[]}),/page/i)
 assert.throws(()=>validateScheduleSource({type:'images',pages:Array(4).fill({mimeType:'image/png',data:'aGVsbG8=',page:1})}),/three/i)
 assert.throws(()=>validateScheduleSource({type:'images',pages:[{mimeType:'image/svg+xml',data:'aGVsbG8='}]}),/image/i)
 assert.throws(()=>validateScheduleSource({type:'images',pages:[{mimeType:'image/png',data:'a'.repeat(4200000)}]}),/fewer/i)
 assert.equal(validateScheduleSource({type:'text',content:'BIO 101\tMWF\t9–10 AM'}).type,'text')
 const {importFile}=await v.ssrLoadModule('/src/lib/study-files.ts')
 assert.equal(await importFile(new File([new Uint8Array(25*1024*1024+1)],'Oversized.pdf',{type:'application/pdf'}),null),'too-big')
 for(const extension of ['doc','docm','xlsx','pptx','zip'])assert.equal(await importFile(new File(['fixture'],`Unsupported.${extension}`,{type:'application/octet-stream'}),null),'unsupported')
 const {extractClassSchedule}=await v.ssrLoadModule('/src/lib/schedule-client.ts')
 const originalFetch=globalThis.fetch, originalTimer=globalThis.setTimeout
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
 try {
  globalThis.setTimeout=(fn,delay,...args)=>originalTimer(fn,delay===30000?1:delay,...args)
  globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))
  await assert.rejects(Promise.race([extractClassSchedule({type:'text',content:'Biology'},new AbortController().signal),new Promise((_,reject)=>originalTimer(()=>reject(new Error('Missing extraction deadline')),100))]),/timed out/i)
 }finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;delete navigator.onLine}
 console.log('schedule source: supported formats, pages, character/image bounds and invalid input pass')
}finally{await v.close()}
