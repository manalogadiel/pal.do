import {createServer} from 'vite'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{const {titleNeedsConfirmation}=await v.ssrLoadModule('/src/lib/title-confidence.ts');assert.equal(titleNeedsConfirmation('it will start at 3pm','Will'),true);assert.equal(titleNeedsConfirmation('I have a meeting later','Meeting'),false);assert.equal(titleNeedsConfirmation('Ito ang baka.','Baka'),true);assert.equal(titleNeedsConfirmation('ang title nito ay Shopping','Shopping'),false);console.log('title confidence: auxiliary titles rejected, grounded names retained, ambiguous speech confirmed')}finally{await v.close()}
