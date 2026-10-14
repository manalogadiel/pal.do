import { createServer } from 'vite'
import assert from 'node:assert/strict'
const vite = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { emptyFocus, updateConversationFocus, eventFromFocus } = await vite.ssrLoadModule('/src/lib/conversation.ts')
  const now = new Date(2026, 9, 14, 10).getTime()
  const old = { ...emptyFocus(), intent: 'event', title: 'Water plant', kind: 'protected', day: now + 86400000, start: now, end: now + 3600000 }
  const fresh = updateConversationFocus(old, 'i have a plan today', now)
  assert.equal(fresh.focus.title, undefined, 'A new unnamed plan must not reuse Water plant')
  assert.equal(fresh.focus.start, undefined)
  assert.equal(fresh.directive, 'newRequest')
  for (const [text, title] of [
    ['ang title nito ay Pagshoshopping, 3pm to 5pm ito', 'Pagshoshopping'],
    ['the title is Grocery shopping, 3pm to 5pm', 'Grocery shopping'],
    ['ang title nito ay Family dinner, 3pm to 5pm', 'Family dinner'],
    ['Pagshoshopping 3pm to 5pm', 'Pagshoshopping'],
    ['the title is Meeting, 3pm to 5pm', 'Meeting'],
    ['ang title nito ay Exam, 3pm to 5pm', 'Exam'],
    ['the title is New event preparation, 3pm to 5pm', 'New event preparation'],
    ['pangalan nito ay Pag-aaral sa library, 3pm hanggang 5pm', 'Pag-aaral sa library'],
  ]) {
    const { focus } = updateConversationFocus(fresh.focus, text, now)
    const event = eventFromFocus(focus)
    assert.equal(event?.title, title, text)
    assert.equal(new Date(event.start).getHours(), 15)
    assert.equal(new Date(event.end).getHours(), 17)
  }
  const renamed = updateConversationFocus(old, 'ang title nito ay Shopping, 3pm to 5pm', now)
  assert.equal(eventFromFocus(renamed.focus)?.title, 'Shopping', 'An explicit title replaces stale focus even without a new-request turn')
  const question = updateConversationFocus(old, 'what is the title of my plan?', now)
  assert.equal(question.focus.title, 'Water plant', 'Questions do not rename events')
  for (const text of ['What time is the new event?', 'What is my new schedule?']) {
    const q = updateConversationFocus(old, text, now)
    assert.equal(q.directive, 'question', text)
    assert.equal(q.focus.title, 'Water plant', 'Questions preserve the pending plan')
  }
  let meeting=updateConversationFocus(old,'I have a meeting later.',now).focus
  assert.equal(meeting.title,'Meeting')
  meeting=updateConversationFocus(meeting,'it will start at 3pm',now).focus
  assert.equal(meeting.title,'Meeting')
  meeting=updateConversationFocus(meeting,'it will end at 4pm.',now).focus
  assert.equal(eventFromFocus(meeting)?.title,'Meeting')
  assert.equal(new Date(eventFromFocus(meeting).end).getHours(),16)
  console.log('plan titles: fresh requests, exact English/Tagalog titles with times, and stale-title replacement pass')
} finally { await vite.close() }
