import { createServer } from 'vite'
import assert from 'node:assert/strict'

// Synthetic credentials only. No real keys or network calls are needed for regressions.
const server = await createServer({define:{'import.meta.env.VITE_GROQ_PROXY_ENABLED':'true','import.meta.env.VITE_GROQ_PROXY_URL':'""'},configLoader:'runner',server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
const realFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
try {
  const { chat, cloudStatus } = await server.ssrLoadModule('/api/_lib/proxy.ts')
  const request = new Request('https://demo.example/api/groq/status')
  assert.deepEqual(await cloudStatus(request, {}).json(), {configured:false})
  assert.deepEqual(await cloudStatus(request, {groq:'test-server-key'}).json(), {configured:true})
  assert.equal(cloudStatus(new Request(request.url, {headers:{Origin:'https://untrusted.example'}}), {groq:'test-server-key'}).status,403)
  assert.ok(!(await cloudStatus(request, {groq:'test-server-key'}).text()).includes('test-server-key'))
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-server-key')
    assert.ok(!options.body.includes('test-server-key'))
    return Response.json({choices:[{message:{content:'OK'}}]})
  }
  const response = await chat(new Request('https://demo.example/api/groq', {method:'POST',body:JSON.stringify({model:'openai/gpt-oss-20b',messages:[{role:'user',content:'Hi'}]})}), {groq:'test-server-key'})
  assert.equal(response.status,200)
  const store = new Map()
  Object.defineProperty(globalThis,'window',{value:{},configurable:true})
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},configurable:true})
  const { getGroqApiKey, setGroqApiKey, cloudSetupAvailable, chooseProvider } = await server.ssrLoadModule('/src/lib/groq.ts')
  assert.equal(getGroqApiKey(),'')
  setGroqApiKey(' test-settings-key ')
  assert.equal(getGroqApiKey(),'test-settings-key')
  assert.equal(await cloudSetupAvailable(),true)
  setGroqApiKey('')
  assert.equal(getGroqApiKey(),'')
  assert.equal(chooseProvider('offline'),'local')
  globalThis.fetch=async()=>Response.json({configured:true})
  assert.equal(await cloudSetupAvailable(),true)
  globalThis.fetch=async()=>Response.json({configured:false})
  assert.equal(await cloudSetupAvailable(),false)
  globalThis.fetch=async()=>{throw new TypeError('offline')}
  assert.equal(await cloudSetupAvailable(),false)
  console.log('demo AI: private preset, status/CORS, Settings override/reset, unavailable status and offline routing pass')
} finally {
  globalThis.fetch=realFetch
  if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else delete globalThis.window
  await server.close()
}
