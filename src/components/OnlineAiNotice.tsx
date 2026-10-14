import { useEffect, useState } from 'react'
import { cloudSetupAvailable } from '../lib/groq'

export default function OnlineAiNotice() {
  const [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    void cloudSetupAvailable(controller.signal).then(value => {
      if (active) setReady(value)
    })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [])
  return <div className="mb-6" role="status">
    <p className="text-[15px] font-medium">{ready === null ? 'Checking your online setup…' : ready ? 'A smart online version is already set up.' : 'Online AI is not ready on this connection.'}</p>
    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{ready ? 'No API key needed to get started. You can use your own key in Settings → AI & models.' : 'You can set or change your API key in Settings → AI & models.'} Your offline tools stay available.</p>
  </div>
}
