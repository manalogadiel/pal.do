import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const {PlacementContent:Placement}=await v.ssrLoadModule('/src/components/AttachmentPlacement.tsx')
 const props={files:[{name:'Notes.txt'}],folders:[],onChoose:async()=>{},onCancel:()=>{}}
 const empty=renderToStaticMarkup(React.createElement(Placement,props))
 for(const text of ['Create folder','Keep in chat','Cancel'])assert.ok(empty.includes(text))
 const existing=renderToStaticMarkup(React.createElement(Placement,{...props,folders:[{id:'bio',name:'Biology'}]}))
 assert.ok(existing.includes('Biology'));assert.ok(existing.includes('Choose a folder'));assert.ok(!existing.includes('value="bio" selected'))
 console.log('attachment placement: explicit choice, empty/existing folders and unfiled option pass')
}finally{await v.close()}
