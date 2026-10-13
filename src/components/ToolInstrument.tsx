import { useId } from 'react'
import type { Method } from '../lib/session'
export type ToolId = Method | 'frog'
/** The same rounded linework as the app's icons, scaled into functional instruments. */
export function ToolInstrument({ tool, progress = 0, resting = false, className = '' }: { tool: ToolId; progress?: number; resting?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  const ink = 'var(--instrument-ink)', blue = 'var(--accent)'
  return <svg data-tool={tool} viewBox="0 0 320 220" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`tool-instrument ${className}`}>
    <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--instrument-fill)"/><stop offset="1" stopColor="var(--instrument-fill-deep)"/></linearGradient></defs>
    {tool === 'pomodoro' && <>
      <rect x="142" y="9" width="36" height="16" rx="6" fill={blue} stroke="none"/>
      <path d="M151 25v12m18-12v12M216 44l10-10"/>
      <circle cx="160" cy="120" r="80" fill={`url(#${id}-fill)`}/>
      <circle cx="160" cy="120" r="65" stroke={blue} strokeOpacity=".18" strokeWidth="7"/>
      {Array.from({length:12},(_,i) => <path key={i} d="M160 48v7" transform={`rotate(${i*30} 160 120)`} strokeOpacity=".5"/>)}
      <circle cx="160" cy="120" r="65" stroke={resting ? 'var(--ev-shift-rule)' : blue} strokeWidth="7" strokeDasharray={`${Math.max(0,Math.min(1,progress))*408.4} 408.4`} transform="rotate(-90 160 120)"/>
      <path d="M102 206h116" strokeOpacity=".18"/>
    </>}
    {tool === 'flowtime' && <>
      <rect x="95" y="18" width="130" height="15" rx="6" fill={`url(#${id}-fill)`}/><rect x="95" y="187" width="130" height="15" rx="6" fill={`url(#${id}-fill)`}/>
      <path d="M105 33c0 43 23 56 42 72-19 16-42 29-42 82M215 33c0 43-23 56-42 72 19 16 42 29 42 82"/>
      <path d="M124 53h72l-36 34z" fill={blue} fillOpacity=".2" stroke="none"/>
      <path d="M123 178c10-18 24-29 37-36 13 7 27 18 37 36" fill={blue} fillOpacity=".2" stroke="none"/>
      <path d="M154 109c-8 7-10 11-8 17m25-17c8 7 10 11 8 17" stroke={blue} strokeOpacity=".5"/>
      <path d="M68 71c-11 12-11 26 0 38m184 24c11 12 11 26 0 38" strokeOpacity=".2"/>
    </>}
    {tool === '52-17' && <>
      <rect x="30" y="42" width="260" height="134" rx="28" fill={`url(#${id}-fill)`}/>
      <rect x="49" y="62" width="222" height="52" rx="14" fill="var(--paper)" strokeOpacity=".3"/>
      <path d="M72 88h24m16 0h24m16 0h24m16 0h24m16 0h17" stroke={blue} strokeWidth="8"/>
      <rect x="49" y="135" width="166" height="20" rx="8" fill={blue} stroke="none"/>
      <rect x="222" y="135" width="49" height="20" rx="8" fill="var(--ev-shift-rule)" stroke="none"/>
      <path d="M79 191h162" strokeOpacity=".18"/>
    </>}
    {tool === 'task' && <>
      <path d="M77 18h116l31 31v148H77z" fill={`url(#${id}-fill)`}/><path d="M193 18v31h31"/>
      {[72,107,142].map((y,i)=><g key={y}><rect x="99" y={y} width="18" height="18" rx="5" stroke={blue}/>{i===0&&<path d={`m103 ${y+9} 4 4 7-9`} stroke={blue}/>}<path d={`M131 ${y+6}h64M131 ${y+14}h${i===1?44:54}`} strokeOpacity=".45"/></g>)}
      <circle cx="246" cy="169" r="30" fill="var(--paper)"/><path d="M246 152v18l10 5" stroke={blue}/><path d="M238 130h16"/>
    </>}
    {tool === 'custom' && <>
      <rect x="32" y="31" width="256" height="160" rx="26" fill={`url(#${id}-fill)`}/>
      <rect x="54" y="52" width="212" height="46" rx="12" fill="var(--paper)" strokeOpacity=".3"/>
      <path d="M82 75h25m18 0h25m18 0h25m18 0h25" stroke={blue} strokeWidth="6"/>
      {[126,154].map((y,i)=><g key={y}><path d={`M58 ${y}h204`} strokeOpacity=".3"/><circle cx={i?206:113} cy={y} r="10" fill="var(--paper)" stroke={blue}/></g>)}
    </>}
    {tool === 'frog' && <>
      <ellipse cx="160" cy="192" rx="92" ry="9" fill={blue} fillOpacity=".08" stroke="none"/>
      <path d="M86 137c-12 8-21 25-25 44 26 10 47 6 60-5m113-39c12 8 21 25 25 44-26 10-47 6-60-5" fill={`url(#${id}-fill)`}/>
      <ellipse cx="160" cy="134" rx="75" ry="53" fill={`url(#${id}-fill)`}/>
      <circle cx="115" cy="79" r="27" fill={`url(#${id}-fill)`}/><circle cx="205" cy="79" r="27" fill={`url(#${id}-fill)`}/>
      <circle cx="115" cy="79" r="7" fill={ink} stroke="none"/><circle cx="205" cy="79" r="7" fill={ink} stroke="none"/>
      <path d="M128 126c18 18 46 18 64 0" stroke={blue}/><path d="M115 163l-12 24m102-24 12 24"/>
      <path d="M253 38v48m0-48h30l-8 12 8 12h-30" stroke={blue}/>
    </>}
  </svg>
}
