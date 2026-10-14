import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const {buildPalKnowledge,answerKnowledgeQuestion}=await v.ssrLoadModule('/src/lib/pal-knowledge.ts')
 const input={query:'what tasks and folders do I have',now:Date.now(),tasks:[{id:'t',title:'Buy milk',notes:'At the corner shop',status:'pile',kind:'task',hours:0,doneHours:0}],folders:[{id:'f',name:'Biology'}],files:[{id:'file',name:'Cells.txt',folderId:'f',chunks:[],scanned:false}]}
 const k=buildPalKnowledge(input,600);assert.ok(k.text.includes('Buy milk')&&k.text.includes('Biology')&&k.text.includes('Cells.txt'));assert.ok(k.text.length<=600)
 assert.ok(answerKnowledgeQuestion('anong tasks ko sa block yard',input).includes('Buy milk'));assert.ok(answerKnowledgeQuestion('what folders do I have',input).includes('Biology'))
 assert.equal(answerKnowledgeQuestion('add Biology tomorrow',input),null)
 const crowded={...input,query:'Explain osmosis from my Biology reviewer',tasks:Array.from({length:8},(_,i)=>({...input.tasks[0],id:String(i),title:'Unrelated task '+i})),files:[{...input.files[0],name:'Biology reviewer.txt',chunks:[{id:'c',page:1,text:'Osmosis is movement of water through a selectively permeable membrane.'}]}]};assert.ok(buildPalKnowledge(crowded,900).text.includes('Osmosis is movement'));
 console.log('Pal knowledge: undated tasks, folders/files, bounded facts and offline inventories pass')
}finally{await v.close()}
