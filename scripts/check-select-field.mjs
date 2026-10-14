import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import assert from 'node:assert/strict'
const v=await createServer({configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const {default:SelectField}=await v.ssrLoadModule('/src/components/SelectField.tsx')
 const html=renderToStaticMarkup(React.createElement(SelectField,{value:'a',options:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}],onValueChange:()=>{},'aria-label':'Category'}))
 for(const text of ['role="combobox"','aria-expanded="false"','type="button"','Category','Alpha'])assert.ok(html.includes(text),text)
 assert.ok(!html.includes('<select'))
 console.log('select field: named controlled combobox without native chooser or implicit submit passes')
}finally{await v.close()}
