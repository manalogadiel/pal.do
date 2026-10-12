import { useEffect, useState } from 'react'
import { AI_MODE_EVENT, getAiMode, isPhoneAiPlatform, setAiMode, type AiMode } from '../lib/ai-mode'

const OPTIONS: { value: AiMode; label: string; phone: string; web: string }[] = [
  { value: 'auto', label: 'Auto', phone: 'Cloud, or this phone offline', web: 'Cloud, or basics offline' },
  { value: 'online', label: 'Online', phone: 'Cloud AI only', web: 'Cloud AI only' },
  { value: 'offline', label: 'Offline', phone: 'On this phone', web: 'Your PC or basics' },
]

const HELP: Record<AiMode, { phone: string; web: string }> = {
  auto: {
    phone: 'Uses the cloud AI when you have internet, and switches to the AI on this phone when you don\'t.',
    web: 'Uses the cloud AI when you have internet. Offline, Pal still handles timers, reminders and simple plans.',
  },
  online: { phone: 'Always uses the cloud AI. Needs internet.', web: 'Always uses the cloud AI. Needs internet.' },
  offline: {
    phone: 'Chat stays on this phone. Slower, and best with simple requests like "Bio exam Friday 3pm".',
    web: 'Never uses the cloud. Uses your PC\'s AI if it\'s set up below, otherwise Pal\'s built-in rules.',
  },
}

export default function AiModeSelector() {
  const [mode, setMode] = useState(getAiMode)
  useEffect(() => {
    const update = () => setMode(getAiMode())
    window.addEventListener(AI_MODE_EVENT, update)
    return () => window.removeEventListener(AI_MODE_EVENT, update)
  }, [])
  const where = isPhoneAiPlatform() ? 'phone' : 'web'
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">AI mode</h3>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="AI mode">
        {OPTIONS.map((o) => (
          <button
            type="button"
            role="radio"
            key={o.value}
            aria-checked={mode === o.value}
            onClick={() => setAiMode(o.value)}
            className={`press min-w-0 rounded-[14px] p-2.5 text-left text-[12px] ${mode === o.value ? 'bg-tangerine/15 text-tangerine' : 'bg-paper text-ink-2'}`}
          >
            <span className="block font-semibold">{o.label}{o.value === 'auto' && <span className="ml-1 font-normal opacity-70">· best</span>}</span>
            <span className="mt-0.5 block leading-snug">{o[where]}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">{HELP[mode][where]}</p>
    </div>
  )
}
