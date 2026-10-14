import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from '../../src/components/Chat'
import '../../src/index.css'
const messages = Array.from({ length: 24 }, (_, i) => ({ id: String(i), from: i % 2 ? 'pal' as const : 'me' as const, text: `Message ${i}: a conversation that fills the feed and makes it scroll.` }))
function Fixture() {
  const [props, update] = useState({ msgs: messages, micOn: false, interim: '', thinking: false })
  ;(window as any).updateChat = (next: object) => update(p => ({ ...p, ...next }))
  ;(window as any).chatMessages = messages
  return <div id="chat-box" style={{ height: 650, width: 420 }}><Chat {...props} bubble={null} pal="jhyvie" palName="Jhyvie" palState="idle" events={[]} onSend={() => {}} onCard={() => {}} onHover={() => {}} onTyping={() => {}} onPoke={() => {}} voiceOn={false} setVoiceOn={() => {}} toggleMic={() => {}} micSupported handsFree={{ on: true, state: 'awake' }} /></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
