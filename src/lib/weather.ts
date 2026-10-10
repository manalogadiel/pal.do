// Today's weather from Open-Meteo (free, no key). Cached so offline answers still have something to say.
import { fmtTime, HOUR, MIN } from './core'

const KEY = 'paldo.weather'
const FRESH = 30 * MIN
// Manila: sensible default when location permission is denied
const FALLBACK = { lat: 14.5995, lon: 120.9842 }

export interface Weather {
  at: number
  temp: number
  desc: string
  /** Epoch ms of each upcoming hour today with ≥50% rain chance */
  rainHours: number[]
}

const WMO: [number, string][] = [
  [0, 'clear'], [3, 'partly cloudy'], [48, 'foggy'], [57, 'drizzly'], [67, 'rainy'],
  [77, 'snowy'], [82, 'rain showers'], [86, 'snow showers'], [99, 'thunderstorms'],
]
const describe = (code: number) => (WMO.find(([max]) => code <= max) ?? WMO[WMO.length - 1])[1]

export function getCachedWeather(): Weather | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || 'null') as Weather | null
    // Yesterday's forecast is worse than none
    return w && new Date(w.at).toDateString() === new Date().toDateString() ? w : null
  } catch {
    return null
  }
}

function position(): Promise<{ lat: number; lon: number }> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(FALLBACK)
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(FALLBACK),
      { timeout: 5000, maximumAge: 6 * HOUR },
    )
  })
}

/** Fetch if online and the cache is stale. Always resolves; null = nothing known. */
export async function refreshWeather(force = false): Promise<Weather | null> {
  const cached = getCachedWeather()
  if (!force && cached && Date.now() - cached.at < FRESH) return cached
  if (typeof navigator !== 'undefined' && !navigator.onLine) return cached
  try {
    const { lat, lon } = await position()
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=precipitation_probability&forecast_days=1&timezone=auto&timeformat=unixtime`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return cached
    const d = await res.json()
    const now = Date.now()
    const rainHours = (d.hourly?.time as number[] ?? [])
      .map((t, i) => ({ t: t * 1000, p: d.hourly.precipitation_probability[i] as number }))
      .filter((h) => h.t + HOUR > now && h.p >= 50)
      .map((h) => h.t)
    const w: Weather = { at: now, temp: Math.round(d.current.temperature_2m), desc: describe(d.current.weather_code), rainHours }
    localStorage.setItem(KEY, JSON.stringify(w))
    return w
  } catch {
    return cached
  }
}

/** "29°C and partly cloudy, rain likely 3pm–6pm (as of 2:10pm)" */
export function weatherLine(w: Weather): string {
  const rain = w.rainHours.length
    ? `, rain likely ${fmtTime(w.rainHours[0])}–${fmtTime(w.rainHours[w.rainHours.length - 1] + HOUR)}`
    : ', no rain expected for the rest of today'
  return `${w.temp}°C and ${w.desc}${rain} (as of ${fmtTime(w.at)})`
}
