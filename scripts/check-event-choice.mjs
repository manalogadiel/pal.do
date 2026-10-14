import { createServer } from 'vite'
import assert from 'node:assert/strict'
const vite = await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try {
 const { suggestedSlotReply } = await vite.ssrLoadModule('/src/lib/event-choice.ts')
 const { extractTitle, parseRange } = await vite.ssrLoadModule('/src/lib/parse.ts')
 const now=new Date(2026,9,14,10).getTime()
 const at=h=>new Date(2026,9,14,h).getTime()
 const card={type:'event',title:'Workday Party',kind:'protected',start:at(17),end:at(19),conflicts:0,clash:['Dinner','Cafe shift'],alt:{start:at(14),end:at(16)}}
 for(const text of ['2 PM–4 PM','yung 2PM-4PM nalang','I choose the 2PM at the 4PM.','Use 2pm','your suggestion','yung suggestion mo','2-4pm']) assert.equal(suggestedSlotReply(text,card,now),'alt',text)
 assert.equal(suggestedSlotReply('yung 2PM-2PM nalang',card,now),'clarify','Repeated endpoints must ask for clarification instead of accepting a 12-hour guess')
 for(const text of ['Do not use 2pm to 4pm','What about 2pm to 4pm?','I have a new meeting 2pm to 4pm','use 2pm to 4pm tomorrow','use 3pm to 4pm','add anyway']) assert.equal(suggestedSlotReply(text,card,now),null,text)
 assert.equal(suggestedSlotReply('your suggestion',{...card,moveOther:{id:'bus',title:'Bus',to:card.alt}},now),null,'Vague acceptance must not override a different recommendation')
 assert.equal(suggestedSlotReply('2pm to 4pm',{...card,alt:undefined},now),null)
 const spoken='Workday Party 5 PM ang Gang 7 PM'
 assert.deepEqual(parseRange(spoken,now),{start:at(17),end:at(19)})
 assert.equal(extractTitle(spoken,''),'Workday Party','A split transcription of hanggang must not become part of the title')
 console.log('event choice: suggested range, Tagalog/English acceptance, voice connector, invalid range, negation and new-request safeguards pass')
} finally {await vite.close()}
