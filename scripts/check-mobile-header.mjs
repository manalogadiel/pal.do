import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const server = await createServer({configLoader:'runner', server:{middlewareMode:true}, appType:'custom',logLevel:'silent'})
try {
 const {Today}=await server.ssrLoadModule('/src/components/Today.tsx')
 const noop=()=>{}, now=new Date(2026,8,30,7).getTime()
 for(const pal of ['rei','diel','jhyvie','jaypee']) {
  const html=renderToStaticMarkup(React.createElement(Today,{now,events:[],tasks:[],pal,palState:'idle',onPoke:noop,onOpen:noop,onPlan:noop,onWeek:noop,onTasks:noop}))
  assert.ok(!html.includes('Talk to'), 'Today must remove the talk shortcut for every pal')
  assert.ok(html.includes('today-date-block') && html.includes('September 30'), 'Date must have a full-width group beside the mascot')
  assert.ok(html.includes('Nothing else booked today'), 'Empty schedule remains readable')
 }
 const manifest=JSON.parse(await readFile('public/manifest.webmanifest','utf8'))
 assert.equal(manifest.theme_color,'#E5F0FF'); assert.equal(manifest.background_color,'#E5F0FF')
 console.log('mobile header: all pals, long date, empty state, and blue manifest pass')
} finally {await server.close()}
