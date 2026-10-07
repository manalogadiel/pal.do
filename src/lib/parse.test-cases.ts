// Runs with ?selftest in the URL. No test runner here, so this is the regression net for phrasing.
import { turn } from './agent'
import { parseDays, parseRange } from './parse'

const hm = (t: number) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }

const RANGES: [string, string | null][] = [
  ['I have 9-12am class', '9:00-12:00'],
  ['class 9-12', '9:00-12:00'],
  ['class from 9 to 12', '9:00-12:00'],
  ['class 1-3 tuesday', '13:00-15:00'],
  ['shift sat 2-8pm', '14:00-20:00'],
  ['my shift is 2-8', '14:00-20:00'],
  ['lab 1pm to 4pm on thursday', '13:00-16:00'],
  ['may klase ako 9-12', '9:00-12:00'],
  ['class 11-1pm', '11:00-13:00'],
  ['class 7:30-9am', '7:30-9:00'],
  ['class 9am-12nn', '9:00-12:00'],
  ['class 8-2', '8:00-14:00'],
  ['score was 3-4', null],
]
const DAYS: [string, number[] | null][] = [
  ['MWF', [1, 3, 5]],
  ['TTh', [2, 4]],
  ['M/W', [1, 3]],
  ['every Monday', [1]],
  ['Mon and Wed', [1, 3]],
  ['Every weekday', [1, 2, 3, 4, 5]],
  ['daily', [1, 2, 3, 4, 5, 6, 0]],
  ['friday', null],
]

export function selftest() {
  const now = Date.now()
  let fail = 0
  for (const [input, want] of RANGES) {
    const r = parseRange(input, now)
    const got = r ? `${hm(r.start)}-${hm(r.end)}` : null
    if (got !== want) { fail++; console.warn('[selftest] range', JSON.stringify(input), 'got', got, 'want', want) }
  }
  for (const [input, want] of DAYS) {
    const got = parseDays(input)
    if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.warn('[selftest] days', JSON.stringify(input), 'got', got, 'want', want) }
  }
  // dialog: class without days → asks; answering MWF → addEvent with days
  const t1 = turn('I have 9-12am class', { pal: 'rei', now, draft: null, awaiting: null })
  if (!t1.pending) { fail++; console.warn('[selftest] class without days should ask which days', t1) }
  const t2 = turn('MWF', { pal: 'rei', now, draft: null, awaiting: null, pending: t1.pending })
  if (t2.action?.type !== 'addEvent' || JSON.stringify(t2.action.days) !== '[1,3,5]') { fail++; console.warn('[selftest] MWF answer', t2) }
  // a class mid-task is its own event, not the task's due date
  const t3 = turn('class 9-12 MWF', { pal: 'rei', now, draft: { title: 'Bio', kind: 'exam' }, awaiting: 'due' })
  if (t3.action?.type !== 'addEvent' || t3.draft?.title !== 'Bio') { fail++; console.warn('[selftest] class mid-draft', t3) }
  console.info(`[selftest] ${fail ? `${fail} failing` : 'all passing'}`)
  return fail
}
