import { useEffect, useRef, useState } from 'react'
import { cloudReady, getLocalAiModel, getLocalAiUrl } from '../lib/groq'
import { AI_MODE_EVENT, getAiMode, isPhoneAiPlatform } from '../lib/ai-mode'

export interface StatusBadgeProps {
  isOnline: boolean
  hasGroqKey: boolean
  activeModel: string
  latency?: number | null
  /** What the last reply did: redirect, findTime, addEvent, chat… */
  lastIntent?: string
  compact?: boolean
  onOpenSettings: () => void
}

export function formatModelDisplayName(model: string): string {
  const m = model.toLowerCase()
  if (m.startsWith('phone/')) return 'This phone · Qwen 0.5B'
  if (!m || m.includes('rule')) return 'Local Rules'
  if (m.includes(':')) return `Your PC · ${model}` // Ollama tags look like qwen3.5:4b
  if (m === 'gemini') return 'Gemini Flash-Lite'
  if (m.includes('qwen3.8')) return 'Groq · Qwen3.8 27B'
  if (m.includes('gpt-oss-120b')) return 'Groq · GPT-OSS 120B'
  if (m.includes('gpt-oss')) return 'Groq · GPT-OSS 20B'
  return model.split('/').pop() || model
}

export function StatusBadge({
  isOnline,
  hasGroqKey,
  activeModel,
  latency,
  lastIntent,
  compact = false,
  onOpenSettings,
}: StatusBadgeProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState(getAiMode)
  useEffect(() => { const update = () => setMode(getAiMode()); window.addEventListener(AI_MODE_EVENT, update); return () => window.removeEventListener(AI_MODE_EVENT, update) }, [])
  const onPhone = isPhoneAiPlatform()
  const pcModel = !onPhone && getLocalAiUrl() ? getLocalAiModel() : ''

  // Where the next reply comes from under this mode: the cloud, this device (phone model / your PC), or the rules
  const cloud = mode !== 'offline' && isOnline && hasGroqKey && cloudReady()
  const device = mode === 'online' ? '' : onPhone ? 'This phone' : pcModel ? 'Your PC' : ''
  const brain = cloud ? 'Cloud' : device || (mode === 'online' ? (isOnline ? 'Not set up' : 'No internet') : 'Basics')
  const onPc = brain === 'Your PC'
  const offlinePhone = brain === 'This phone'
  const isAiOnline = cloud || !!device
  // Rose: Online mode with no way to the cloud. Amber: answering without the cloud. Green: cloud.
  const isNetworkOffline = mode === 'online' && !cloud
  const isLocalOnly = !cloud && !isNetworkOffline

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', handleClick)
    return () => window.removeEventListener('pointerdown', handleClick)
  }, [open])

  const dotColor = isNetworkOffline
    ? 'bg-rose-500'
    : isLocalOnly
      ? 'bg-amber-500'
      : 'bg-emerald-500'

  const pingColor = isNetworkOffline
    ? 'bg-rose-400'
    : isLocalOnly
      ? 'bg-amber-400'
      : 'bg-emerald-400'

  const statusText = `${mode === 'auto' ? 'Auto' : mode === 'online' ? 'Online' : 'Offline'} · ${brain}`

  const modelDisplay = formatModelDisplayName(activeModel)

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press group relative flex items-center gap-1.5 whitespace-nowrap rounded-full border border-ink/[0.08] bg-paper/75 px-2.5 py-1 text-[11px] font-medium text-ink shadow-[var(--edge)] backdrop-blur-xl transition-all hover:bg-paper"
        aria-label="AI and network status"
        title={`${statusText} · ${modelDisplay}${latency ? ` · ${latency}ms` : ''}`}
      >
        <span className="relative flex size-2 shrink-0">
          {isAiOnline && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingColor} opacity-75`}
            />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${dotColor}`} />
        </span>

        <span className="font-semibold">{statusText}</span>

        {!compact && (
          <>
            <span className="text-ink/30">·</span>
            <span className="max-w-[110px] truncate text-ink-2">{modelDisplay}</span>
          </>
        )}

        {latency != null && latency > 0 && !compact && (
          <span className="tnum font-mono text-[9.5px] text-ink-3">{latency}ms</span>
        )}
      </button>

      {/* Details Popover */}
      {open && (
        <div className="pop absolute right-0 top-full z-50 mt-2 w-72 rounded-[20px] border border-ink/[0.08] bg-paper/95 p-4 text-[12px] text-ink shadow-[0_12px_36px_-6px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
          <div className="flex items-center justify-between pb-2.5 border-b border-ink/[0.06]">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                {isAiOnline && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingColor} opacity-75`}
                  />
                )}
                <span className={`relative inline-flex size-2.5 rounded-full ${dotColor}`} />
              </span>
              <span className="font-semibold text-[13px]">{statusText}</span>
            </div>
            <span className="rounded-full bg-tangerine/15 px-2 py-0.5 text-[9.5px] font-semibold text-tangerine">
              Advanced Mode
            </span>
          </div>

          <div className="mt-3 space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-ink-3">Internet Status</span>
              <span className="font-medium">
                {isOnline ? '🟢 Connected' : '🔴 Disconnected'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-ink-3">AI Brain</span>
              <span className="font-medium">
                {offlinePhone ? 'On this phone' : onPc ? "Your PC's AI (Ollama)" : cloud ? 'Cloud AI' : 'Built-in rules'}
              </span>
            </div>

            <div className="flex justify-between items-start gap-2">
              <span className="text-ink-3 shrink-0">Last reply</span>
              <span className="text-[11px] text-right font-medium text-ink">
                {formatModelDisplayName(activeModel)}{lastIntent ? ` · ${lastIntent}` : ''}
              </span>
            </div>

            <div className="flex justify-between items-start gap-2">
              <span className="text-ink-3 shrink-0">Active Model</span>
              <span className="font-mono text-[11px] text-right font-medium text-ink truncate max-w-[160px]" title={activeModel}>
                {activeModel || 'Local Rules'}
              </span>
            </div>

            {mode !== 'offline' && (hasGroqKey || pcModel || onPhone) && (
              <div className="flex justify-between items-start gap-2">
                <span className="text-ink-3 shrink-0">Fallback Chain</span>
                <span className="font-mono text-[10.5px] text-right text-ink-2">
                  {[hasGroqKey && 'Groq → Gemini', mode === 'auto' && onPhone && 'This phone', mode === 'auto' && pcModel && `Your PC (${pcModel})`, 'Rules'].filter(Boolean).join(' → ')}
                </span>
              </div>
            )}

            {latency != null && latency > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-ink-3">Last Latency</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">{latency} ms</span>
              </div>
            )}

            <div className="flex justify-between items-start gap-2 pt-1 border-t border-ink/[0.06]">
              <span className="text-ink-3 shrink-0">Safety Shield</span>
              <span className="text-[11px] text-right text-ink-2">
                3-Layer Guardrails Active
              </span>
            </div>
          </div>

          <div className="mt-4 pt-2.5 border-t border-ink/[0.06] flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="press flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-3 py-1 text-[11.5px] font-medium text-ink hover:bg-ink/[0.1]"
            >
              Preferences ⚙️
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="press text-[11.5px] text-ink-3 hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StatusBadge
