import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
const server = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { Study, Focus } = await server.ssrLoadModule('/src/components/Study.tsx')
  const { ToolGallery, ToolSetup } = await server.ssrLoadModule('/src/components/StudyTools.tsx')
  const { start, pause, skip, nextRound, finish, configure, DEFAULT_CONFIG, IDLE } = await server.ssrLoadModule('/src/lib/session.ts')
  const noop = () => {}, props = { session: IDLE, pal: 'rei', palState: 'idle', todayMinutes: 0, alarmsOn: true, tasks: [], section: 'focus', onSection: noop, onStart: noop, onConfigure: noop, onNext: noop, onRecover: noop, onBrowse: noop, onPause: noop, onResume: noop, onSkip: noop, onStop: noop, onEnableAlarms: noop, onPlanFile: noop, onToast: noop, tabsInHeader: true }
  const idle = renderToStaticMarkup(React.createElement(Study, props))
  assert.ok(idle.includes('25:00')&&idle.includes('Throw away'), 'Idle Pomodoro opens timer and distraction bin')
  assert.ok(!idle.includes('Choose your focus tool'))
  const gallery = renderToStaticMarkup(React.createElement(ToolGallery, { onSelect: noop }))
  assert.ok(gallery.includes('data-tool="pomodoro"')); assert.ok(!gallery.includes('data-tool="flowtime"'), 'Primary gallery should be focused')
  const setup = renderToStaticMarkup(React.createElement(ToolSetup, { choice: 'frog', tasks: [], onBack: noop, onOpen: noop }))
  assert.equal((setup.match(/type="radio"/g) || []).length, 2, 'Eat the Frog must offer two timers')
  assert.ok(!setup.includes('checked=""'), 'Eat the Frog must not select a timer automatically')
  assert.ok(setup.includes('disabled=""'), 'Opening an incomplete setup must be disabled')
  for (const tool of ['pomodoro','flowtime','52-17','task','custom','frog']) {
    const config = { ...DEFAULT_CONFIG, method: tool === 'frog' ? 'pomodoro' : tool, preparation: tool === 'frog' ? 'frog' : undefined, goal: 'Review chapter one' }
    const selected = renderToStaticMarkup(React.createElement(ToolSetup, { choice: tool, tasks: [], onBack: noop, onOpen: noop }))
    assert.ok(selected.includes('Open timer') && !selected.includes('>Pause<'), 'Selection must remain setup, with no running controls')
    const ready = renderToStaticMarkup(React.createElement(Study, { ...props, session: configure(config) }))
    assert.ok(ready.includes('>Start<'), 'A remembered ready timer must return to its workspace')
    const running = start(Date.now(),config)
    const skipped = skip(running, Date.now())
    for (const session of [configure(config), running, pause(running, Date.now()), skipped, nextRound(skipped, Date.now()), finish(running, Date.now())]) {
      const html = renderToStaticMarkup(React.createElement(Focus, { ...props, session, screen: 'workspace', onScreen: noop }))
      assert.ok(html.includes(`data-workspace="${tool}"`), `${tool} must return to its workspace`)
      assert.ok(!html.includes('All tools'), 'Primary timer has no gallery navigation')
      if (session.phase === 'break' && tool === 'flowtime') assert.ok(html.includes('Time remaining'), 'Flowtime breaks show remaining time')
      if (session.phase === 'breakReady') assert.ok(html.includes('Suggested break') && !html.includes('>00:00<'), 'Suggested breaks show their duration')
      if (session.phase === 'ready') assert.ok(html.includes('>Start<') && !html.includes('>Pause<'), 'Prepared timers require explicit Start')
      if (session.phase === 'finished') assert.ok(html.includes('New Pomodoro'), 'Finished timer can prepare another session')
      if (session.pausedLeft !== undefined) assert.ok(html.includes('Resume'), 'Paused sessions retain Resume')
    }
  }
  const adjusted = renderToStaticMarkup(React.createElement(ToolSetup, { choice: 'custom', initialConfig: { ...DEFAULT_CONFIG, method: 'custom', focusMinutes: 42, goal: 'Keep this goal', folderId: 'bio', folderName: 'Biology' }, tasks: [], onBack: noop, onOpen: noop }))
  assert.ok(adjusted.includes('Keep this goal') && adjusted.includes('Biology') && adjusted.includes('value="42"'), 'Adjust timer must preserve current values, goal and subject')
  console.log('study UI: focused gallery, explicit Start, and all legacy active/paused workspaces pass')
} finally { await server.close() }
