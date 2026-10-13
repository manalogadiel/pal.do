import { useEffect, useMemo, useState } from 'react'
import type { PalId, PalState } from '../lib/core'

/* Pixel pals, full body on a 20×28 grid.
   Head: shape → shading → outline. Body: torso, arms, legs drawn behind the head
   into empty cells only, then their own outline pass. Face and props go last. */

type Key = string
type Grid = (Key | null)[][]
const W = 20
const H = 28

export const PALS: Record<PalId, { name: string; line: string; tone: string; swatch: string }> = {
  rei: { name: 'Rei', line: 'Direct and clear', tone: 'Answer first, no filler', swatch: '#c9c3e6' },
  diel: { name: 'Diel', line: 'Calm and gentle', tone: 'Warm, patient, and reassuring', swatch: '#a6dcc6' },
  jhyvie: { name: 'Jhyvie', line: 'Your Tagalog friend', tone: 'Natural Tagalog with a little Taglish', swatch: '#f8c9a8' },
  jaypee: { name: 'Jaypee', line: 'Playful and funny', tone: 'Useful answers with a little humor', swatch: '#f7d046' },
}

const BASE_PAL: Record<Key, string> = {
  o: '#2e2925', e: '#2e2925', w: '#ffffff', a: '#ec7a4f', c: '#f29ab0', d: '#7cbfee', z: '#a39d93', r: '#f0708f',
}
// t / T = outfit + its shade, L = limbs, f = feet
const PALETTES: Record<PalId, Record<Key, string>> = {
  rei: { b: '#cdc7ea', s: '#aaa3d6', h: '#efecfc', t: '#f3d9c9', T: '#e2bca6', L: '#aaa3d6', f: '#8f87c4' },
  diel: { b: '#a9dec9', s: '#82c2a9', h: '#d8f3e7', k: '#22322c', k2: '#30463d', g: '#80f0c2', t: '#5d7f74', T: '#4a685e', L: '#82c2a9', f: '#3d554c' },
  jhyvie: { b: '#f8cbab', s: '#e9aa86', h: '#fde8d8', c: '#f08fa9', t: '#f5b8c8', T: '#e597ad', L: '#e9aa86', f: '#c9846a' },
  jaypee: { b: '#f6d04f', s: '#ddb02c', h: '#fdeea8', k: '#4274d6', k2: '#2d55a2', a: '#f28a3f', t: '#4274d6', T: '#2d55a2', L: '#f28a3f', f: '#d9702c' },
}

const FACE: Record<PalId, { ex: [number, number]; ey: number; mx: number; my: number; eye: Key }> = {
  rei: { ex: [7, 12], ey: 11, mx: 10, my: 15, eye: 'e' },
  diel: { ex: [7, 12], ey: 9, mx: 10, my: 12, eye: 'g' },
  jhyvie: { ex: [7, 12], ey: 12, mx: 10, my: 15, eye: 'e' },
  jaypee: { ex: [7, 12], ey: 11, mx: 10, my: 14, eye: 'e' },
}

const blank = (): Grid => Array.from({ length: H }, () => Array<Key | null>(W).fill(null))
function px(g: Grid, x: number, y: number, k: Key) {
  if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = k
}
function under(g: Grid, x: number, y: number, k: Key) {
  if (x >= 0 && x < W && y >= 0 && y < H && !g[y][x]) g[y][x] = k
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, k: Key) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, k)
}
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, k: Key) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g[y][x] = k
}
function shadeAndLight(g: Grid) {
  for (let x = 0; x < W; x++) {
    const ys = g.map((r, y) => (r[x] === 'b' ? y : -1)).filter((y) => y >= 0)
    if (ys.length > 3) {
      const max = Math.max(...ys)
      px(g, x, max, 's')
      if (ys.includes(max - 1)) px(g, x, max - 1, 's')
    }
  }
  for (let y = 0; y < H; y++) {
    const x = g[y].findIndex((k) => k === 'b')
    if (x >= 0 && g[y + 1]?.[x + 1] === 'b') {
      px(g, x + 1, y + 1, 'h')
      px(g, x + 2, y + 1, 'h')
      px(g, x + 1, y + 2, 'h')
      return
    }
  }
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
function outline(g: Grid, only?: Set<Key>) {
  const src = g.map((r) => [...r])
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!src[y][x] && N4.some(([dx, dy]) => { const k = src[y + dy]?.[x + dx]; return k && (!only || only.has(k)) })) g[y][x] = 'o'
}
function Z(g: Grid, x: number, y: number) {
  ;[[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]].forEach(([dx, dy]) => px(g, x + dx, y + dy, 'z'))
}
function heart(g: Grid, x: number, y: number) {
  ;[[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]].forEach(([dx, dy]) => px(g, x + dx, y + dy, 'r'))
}

/* ---------- head ---------- */
function head(id: PalId, g: Grid, f: number, state: PalState) {
  if (id === 'rei') {
    ellipse(g, 10, 12.5, 7.5, 6.2, 'b')
    ellipse(g, 6.5, 9.5, 3, 2.6, 'b')
    ellipse(g, 13.5, 9.5, 3, 2.6, 'b')
    shadeAndLight(g)
    outline(g)
    const sway = state === 'idle' && f % 2 ? 1 : 0
    px(g, 10, 6, 'o')
    px(g, 10 + sway, 5, 'o')
    const sx = 10 + sway
    if (state === 'sleeping') px(g, sx, 3, 'o')
    else if (f % 2 && state === 'idle') px(g, sx, 3, 'a')
    else [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]].forEach(([dx, dy]) => px(g, sx + dx, 3 + dy, 'a'))
  }
  if (id === 'diel') {
    rect(g, 3, 5, 16, 16, 'b')
    ;[[3, 5], [16, 5], [3, 16], [16, 16]].forEach(([x, y]) => (g[y][x] = null))
    shadeAndLight(g)
    rect(g, 5, 7, 14, 13, 'k')
    outline(g)
    if (state === 'idle' || state === 'listening') rect(g, 5, 7 + (f % 7), 14, 7 + (f % 7), 'k2')
    px(g, 10, 4, 'o')
    px(g, 10, 3, 'o')
    px(g, 10, 2, state === 'sleeping' ? 'o' : f % 2 ? 'a' : 'g')
  }
  if (id === 'jhyvie') {
    ellipse(g, 10, 13, 6.6, 6, 'b')
    const flopL = state === 'idle' && f === 1
    const flopR = state === 'idle' && f === 3
    const droop = state === 'sleeping' || state === 'alarmed'
    if (flopL || droop) rect(g, 3, 6, 6, 7, 'b')
    else {
      rect(g, 6, 2, 7, 8, 'b')
      rect(g, 7, 3, 7, 6, 'c')
    }
    if (flopR || droop) rect(g, 13, 6, 16, 7, 'b')
    else {
      rect(g, 12, 2, 13, 8, 'b')
      rect(g, 12, 3, 12, 6, 'c')
    }
    shadeAndLight(g)
    outline(g)
  }
  if (id === 'jaypee') {
    ellipse(g, 10, 12.5, 6.6, 6, 'b')
    shadeAndLight(g)
    rect(g, 5, 4, 14, 7, 'k')
    g[4][5] = null
    g[4][14] = null
    rect(g, 13, 7, 17, 8, 'k2')
    px(g, 9, 5, 'w')
    outline(g)
  }
}

/* ---------- body: arms are cell paths from the shoulder; right arm mirrors left ---------- */
type Path = [number, number][]
const ARM: Record<string, Path> = {
  down: [[5, 19], [4, 20], [4, 21], [4, 22]],
  swing: [[5, 19], [4, 20], [3, 21], [3, 22]],
  up: [[4, 19], [3, 18], [2, 17], [1, 16], [1, 15]],
  half: [[4, 19], [3, 19], [2, 18], [2, 17]],
  cheek: [[4, 19], [3, 18], [2, 17], [2, 16], [3, 15]],
  ear: [[4, 19], [3, 18], [2, 17], [1, 16], [1, 15], [1, 14], [2, 13]],
  tuck: [[5, 19], [6, 20], [7, 21]],
  pump: [[4, 19], [3, 18], [3, 17], [3, 16], [2, 16], [3, 15]],
}
const mirror = (p: Path): Path => p.map(([x, y]) => [W - 1 - x, y])

function pose(state: PalState, f: number, action?: string): [string, string] {
  if (action === 'stretch') return ['up', 'up']
  if (action === 'look') return f % 2 ? ['half', 'down'] : ['down', 'half']
  switch (state) {
    case 'idle': return f % 2 ? ['swing', 'down'] : ['down', 'swing']
    case 'listening': return ['ear', 'down']
    case 'talking': return ['down', f % 2 ? 'half' : 'swing']
    case 'sleeping': return ['tuck', 'tuck']
    case 'alert': return ['down', 'up']
    case 'wave': return ['down', f % 2 ? 'up' : 'half']
    case 'alarmed': return ['cheek', 'cheek']
    case 'shocked': return ['up', 'up']
    case 'cheer': return f % 2 ? ['pump', 'down'] : ['pump', 'pump']
    case 'happy': return f % 2 ? ['up', 'half'] : ['half', 'up']
  }
}

function bodyParts(g: Grid, state: PalState, f: number, action?: string, tap?: boolean) {
  const sit = state === 'sleeping'
  const top = sit ? 19 : 18
  // torso, rounded bottom corners
  for (let y = top; y <= 23; y++) for (let x = 6; x <= 13; x++) under(g, x, y, y === 23 ? 'T' : 't')
  g[23][6] = g[23][6] === 'T' ? null : g[23][6]
  g[23][13] = g[23][13] === 'T' ? null : g[23][13]
  // legs + feet
  if (sit) {
    rect(g, 5, 24, 8, 24, 'f')
    rect(g, 11, 24, 14, 24, 'f')
  } else {
    const lift = tap ? 1 : 0
    rect(g, 7, 24, 8, 25, 'L')
    rect(g, 11, 24 - lift, 12, 25 - lift, 'L')
    rect(g, 6, 26, 8, 26, 'f')
    rect(g, 11, 26 - lift, 13, 26 - lift, 'f')
  }
  const [l, r] = pose(state, f, action)
  ARM[l].forEach(([x, y]) => under(g, x, y, 'L'))
  mirror(ARM[r]).forEach(([x, y]) => under(g, x, y, 'L'))
  outline(g, new Set(['t', 'T', 'L', 'f']))
}

/* ---------- face + props ---------- */
function face(id: PalId, g: Grid, state: PalState, f: number, tick: number) {
  const F = FACE[id]
  const E = F.eye
  const [l, r] = F.ex
  const { ey, mx, my } = F
  const blink = (state === 'idle' || state === 'talking' || state === 'listening') && tick % 18 === 0
  const skin = id === 'diel' ? 'k' : 'b'
  const joy = state === 'happy' || state === 'cheer' || state === 'wave'

  for (const x of [l, r]) {
    if (state === 'sleeping') rect(g, x, ey + 1, x + 1, ey + 1, E)
    else if (blink) px(g, x, ey + 1, E)
    else if (joy) {
      px(g, x - 1, ey + 1, E)
      px(g, x, ey, E)
      px(g, x + 1, ey + 1, E)
    } else if (state === 'shocked') {
      rect(g, x - 1, ey - 1, x + 1, ey + 1, E)
      px(g, x, ey, id === 'diel' ? 'k' : 'w')
    } else if (state === 'listening' || state === 'alert') {
      rect(g, x, ey, x + 1, ey + 1, E)
      px(g, x, ey, id === 'diel' ? 'k2' : 'w')
    } else if (state === 'alarmed') {
      rect(g, x, ey, x, ey + 1, E)
      px(g, x + (x === l ? -1 : 1), ey - 1, E)
    } else rect(g, x, ey, x, ey + 1, E)
  }
  if (id === 'jhyvie' || (id === 'rei' && state !== 'sleeping') || joy) {
    px(g, l - 1, ey + 2, 'c')
    px(g, r + 1, ey + 2, 'c')
  }

  if (id === 'jaypee') {
    const open = (state === 'talking' && tick % 3 !== 0) || state === 'shocked' || joy
    rect(g, mx - 1, my, mx, my, 'a')
    if (open) {
      rect(g, mx - 1, my + 1, mx, my + 1, 'o')
      rect(g, mx - 1, my + 2, mx, my + 2, 'a')
    } else rect(g, mx - 1, my + 1, mx, my + 1, 'a')
  } else {
    const M = id === 'diel' ? 'g' : 'e'
    if (state === 'talking') {
      const m = tick % 3
      if (m === 0) rect(g, mx - 1, my, mx, my, M)
      else if (m === 1) {
        rect(g, mx - 1, my - 1, mx, my, M)
        if (id !== 'diel') rect(g, mx - 1, my, mx, my, 'c')
      } else rect(g, mx - 2, my, mx + 1, my, M)
    } else if (joy) {
      px(g, mx - 3, my - 1, M)
      rect(g, mx - 2, my, mx + 1, my, M)
      px(g, mx + 2, my - 1, M)
      if (id !== 'diel') rect(g, mx - 1, my + 1, mx, my + 1, 'c')
    } else if (state === 'shocked') {
      rect(g, mx - 1, my - 1, mx, my + 1, M)
      rect(g, mx - 1, my, mx, my, skin)
      px(g, mx - 1, my, M)
    } else if (state === 'alarmed') {
      ;[[-2, 0], [-1, -1], [0, 0], [1, -1]].forEach(([dx, dy]) => px(g, mx + dx, my + dy, M))
    } else if (state === 'sleeping' || state === 'listening') px(g, mx, my, M)
    else [[-2, -1], [-1, 0], [0, 0], [1, -1]].forEach(([dx, dy]) => px(g, mx + dx, my + dy, M))
  }

  if (state === 'sleeping') {
    Z(g, 15, 4 - (f % 2))
    if (f >= 2) Z(g, 17, 0)
  }
  if (state === 'alert') {
    rect(g, 18, 1, 18, 3, 'a')
    px(g, 18, 5, 'a')
  }
  if (state === 'alarmed') {
    px(g, r + 3, ey - 2, 'd')
    rect(g, r + 3, ey - 1, r + 4, ey, 'd')
  }
  if (state === 'listening') {
    const h = f % 2 ? 2 : 1
    rect(g, 19, 11 - (3 - h), 19, 11 + (3 - h), 'a')
  }
  if (state === 'happy') heart(g, 16, 2 - (f % 2))
  if (state === 'cheer' && f % 2) {
    px(g, 1, 3, 'a')
    px(g, 18, 2, 'a')
    px(g, 3, 1, 'r')
  }
}

export function build(id: PalId, state: PalState, tick: number, action?: string): Grid {
  const g = blank()
  const f = tick % 4
  head(id, g, f, state)
  bodyParts(g, state, f, action, (id === 'jaypee' && state === 'idle' && f % 2 === 1) || action === 'tap')
  face(id, g, state, f, tick)
  return g
}

function useTick(ms: number, on: boolean) {
  const [t, setT] = useState(1)
  useEffect(() => {
    if (!on) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const i = setInterval(() => setT((n) => n + 1), ms)
    return () => clearInterval(i)
  }, [ms, on])
  return t
}

const FIDGETS = ['stretch', 'look', 'tap'] as const

/** size = rendered width. Full body is 1.4× as tall; below 40px it renders head-only. */
export function Pal({
  id: rawId, state = 'idle', size = 96, animate = true, float = false, className = '', onPoke,
}: { id: PalId; state?: PalState; size?: number; animate?: boolean; float?: boolean; className?: string; onPoke?: () => void }) {
  const id: PalId = rawId in PALS ? rawId : 'rei' // tolerate stale or missing ids
  const bust = size < 40
  const speed = state === 'talking' ? 140 : state === 'sleeping' ? 700 : state === 'listening' ? 220 : 300
  const tick = useTick(speed, animate)
  const [squish, setSquish] = useState(0)
  const [fidget, setFidget] = useState<string | undefined>()

  // cute idle fidgets every ~20s
  useEffect(() => {
    if (!animate || bust || state !== 'idle') return
    const i = setInterval(() => {
      setFidget(FIDGETS[Math.floor(Math.random() * FIDGETS.length)])
      setTimeout(() => setFidget(undefined), 1400)
    }, 20_000)
    return () => clearInterval(i)
  }, [animate, bust, state])

  const grid = useMemo(() => build(id, state, tick, state === 'idle' ? fidget : undefined), [id, state, tick, fidget])
  const colors = { ...BASE_PAL, ...PALETTES[id] }
  const rows = bust ? 20 : H
  const runs: { x: number; y: number; w: number; k: Key }[] = []
  grid.slice(0, rows).forEach((row, y) => {
    let x = 0
    while (x < W) {
      const k = row[x]
      if (!k) {
        x++
        continue
      }
      let w = 1
      while (row[x + w] === k) w++
      runs.push({ x, y, w, k })
      x += w
    }
  })
  const h = Math.round((size * rows) / W)
  const Tag = onPoke ? 'button' : 'div'
  return (
    <Tag
      className={`relative inline-block shrink-0 ${onPoke ? 'cursor-pointer outline-none' : ''} ${className}`}
      style={{ width: size, height: h }}
      aria-label={`${PALS[id].name}, ${state}${onPoke ? '. Poke' : ''}`}
      role={onPoke ? undefined : 'img'}
      onClick={onPoke ? () => { setSquish((n) => n + 1); onPoke() } : undefined}
    >
      <div className={`absolute bottom-0 left-1/2 h-[5%] w-[58%] -translate-x-1/2 rounded-[50%] bg-ink/12 blur-[1px] ${float ? 'float-shadow' : ''}`} />
      <div className={`h-full w-full ${float ? 'float' : ''}`}>
        <div key={`${squish}`} className={`h-full w-full ${squish ? 'squish' : ''}`}>
          <div key={state} className={animate ? `pal-${state} h-full w-full` : 'h-full w-full'}>
            <svg viewBox={`0 0 ${W} ${rows}`} width={size} height={h} shapeRendering="crispEdges" className="overflow-visible">
              {runs.map((r, i) => (
                <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={colors[r.k] ?? '#f0f'} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </Tag>
  )
}
