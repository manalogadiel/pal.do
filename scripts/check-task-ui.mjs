import assert from "node:assert/strict"
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
)
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--headless=new"],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://localhost:8443" &&
    !/^\/(api|tts)(?:\/|$)/.test(new URL(r.request().url()).pathname)
      ? r.continue()
      : r.fulfill({ status: 503, body: "{}" }),
  )
  await page.addInitScript(() => {
    localStorage.setItem("paldo.ai-mode", "offline")
    if (!localStorage.getItem("paldo.view"))
      localStorage.setItem("paldo.view", "tasks")
    if (!localStorage.getItem("paldo-v1"))
      localStorage.setItem(
        "paldo-v1",
        JSON.stringify({
          settings: {
            pal: "rei",
            name: "Rei",
            onboarded: true,
            voiceOn: false,
            notify: false,
            notifyAsked: true,
            lastBrief: new Date().toDateString(),
          },
          events: [],
          tasks: [],
          msgs: [],
          asked: [],
          alerted: [],
          log: {},
          offset: 0,
        }),
      )
    window.Worker = class {
      postMessage() {}
      terminate() {}
    }
  })
  await page.goto("http://localhost:8443", { waitUntil: "domcontentloaded" })
  await page
    .getByRole("button", { name: "New task", exact: true })
    .click({ timeout: 3000 })
  await page.getByLabel("Task title", { exact: true }).fill("Buy groceries")
  await page.getByLabel("Notes", { exact: true }).fill("Milk\nBread")
  await page.getByRole("button", { name: "Save task", exact: true }).click()
  await page
    .getByRole("button", { name: "Edit Buy groceries", exact: true })
    .click()
  assert.equal(
    await page.getByLabel("Notes", { exact: true }).inputValue(),
    "Milk\nBread",
  )
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Buy groceries today")
  await page.getByRole("button", { name: "Save task", exact: true }).click()
  await page.reload({ waitUntil: "domcontentloaded" })
  await page
    .getByRole("button", { name: "Edit Buy groceries today", exact: true })
    .waitFor()
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("paldo-v1")),
  )
  assert.equal(saved.tasks.length, 1)
  assert.equal(saved.events.length, 0)
  assert.equal(saved.tasks[0].notes, "Milk\nBread")
  await page
    .getByRole("button", { name: "Edit Buy groceries today", exact: true })
    .click()
  await page.getByLabel("Task title", { exact: true }).fill("Discard me")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Edit Buy groceries today", exact: true })
    .click()
  await page.getByText("Time & details", { exact: false }).click()
  await page
    .getByLabel("Scheduled start", { exact: true })
    .fill("2026-11-10T14:00")
  await page
    .getByLabel("Scheduled end", { exact: true })
    .fill("2026-11-10T15:00")
  await page.getByRole("button", { name: "Save task", exact: true }).click()
  await page.getByRole("button", { name: "New task", exact: true }).click()
  await page.getByLabel("Task title", { exact: true }).fill("Overlap test")
  await page.getByText("Time & details", { exact: false }).click()
  await page
    .getByLabel("Scheduled start", { exact: true })
    .fill("2026-11-10T14:30")
  await page
    .getByLabel("Scheduled end", { exact: true })
    .fill("2026-11-10T15:30")
  await page.getByRole("button", { name: "Save task", exact: true }).click()
  await page
    .getByRole("alert")
    .filter({ hasText: "overlaps Buy groceries" })
    .waitFor()
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("paldo-v1")).events.length,
    ),
    1,
  )
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Complete Buy groceries today", exact: true })
    .click()
  let state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("paldo-v1")),
  )
  assert.equal(state.tasks[0].status, "done")
  assert.equal(state.events[0].status, "done")
  assert.equal(state.events.length, 1)
  await page.getByRole("button", { name: "Reopen", exact: true }).click()
  await page
    .getByRole("button", { name: "Edit Buy groceries today", exact: true })
    .click()
  await page.getByRole("button", { name: "Remove scheduled time" }).click()
  await page.getByRole("button", { name: "Save task", exact: true }).click()
  state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("paldo-v1")),
  )
  assert.equal(state.events.length, 0)
  assert.equal(state.tasks[0].status, "pile")
  for (let i = 1; i <= 3; i++) {
    await page.getByLabel("Quick add task").fill("Task " + i)
    await page.getByLabel("Quick add task").press("Enter")
    await page.getByLabel("Move Task " + i, {exact:true}).click()
    await page.getByRole('option',{name:'Workbench',exact:true}).click()
  }
  await page.getByLabel("Move Buy groceries today",{exact:true}).click()
  await page.getByRole('option',{name:'Workbench',exact:true}).click()
  state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("paldo-v1")),
  )
  assert.equal(state.tasks.filter((t) => t.status === "doing").length, 3)
  assert.equal(state.tasks[0].status, "pile")
  const moveOne=page.getByLabel('Move Task 1',{exact:true});await moveOne.focus();await moveOne.click();await page.getByRole('option',{name:'Pile',exact:true}).click()
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Move Task 1')
  const grip=page.getByRole('button',{name:'Drag Task 1',exact:true})
  await grip.scrollIntoViewIfNeeded()
  const source=await grip.boundingBox(),paper=await grip.locator('xpath=ancestor::article').boundingBox(),target=await page.locator('.zone-doing').boundingBox()
  const touch=await page.context().newCDPSession(page)
  const point={x:source.x+source.width/2,y:source.y+source.height/2}
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+20,y:point.y}]})
  const preview=await page.locator('.yard-drag-preview').boundingBox();assert.ok(Math.abs(preview.x-(point.x+20-(point.x-paper.x)))<2,'Drag preview follows grab offset')
  await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('paldo-v1')).tasks.find(t=>t.title==='Task 1').status),'pile')
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:target.x+target.width/2,y:point.y}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('paldo-v1')).tasks.find(t=>t.title==='Task 1').status==='doing')
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [844, 390],
    [320, 340],
  ]) {
    await page.setViewportSize({ width, height })
    await page.getByRole("button", { name: "New task", exact: true }).click()
    const box = await page.locator(".task-editor").boundingBox()
    assert.ok(
      box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= width + 1 &&
        box.y + box.height <= height + 1,
      JSON.stringify({ width, height, box }),
    )
    await page
      .getByRole("button", { name: "Save task", exact: true })
      .scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click()
  await page.getByRole('button',{name:'New task',exact:true}).click()
  await page.screenshot({path:process.env.TASK_CAPTURE_PATH||'.playwright-mcp/adaptive/task-editor-dark.png'})
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /^Study/ })
    .click()
  await page.getByRole("tab", { name: "Pomodoro", exact: true }).click()
  await page.getByRole("button", { name: "Start", exact: true }).waitFor()
  assert.equal(await page.getByText("Your goal", { exact: false }).count(), 0)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Start", exact: true }).waitFor()
  await page.getByRole("button", { name: "Start", exact: true }).click()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor()
  console.log(
    "task UI: offline notes, cancel, calendar sync, board limits, seven editor sizes and direct Pomodoro reload pass",
  )
} finally {
  await browser.close()
}
