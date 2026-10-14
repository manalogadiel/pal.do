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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://localhost:8443" &&
    !/^\/(api|tts)(?:\/|$)/.test(new URL(r.request().url()).pathname)
      ? r.continue()
      : r.fulfill({ status: 503, body: "{}" }),
  )
  await page.goto(
    "http://localhost:8443/scripts/fixtures/adaptive-ui.html?surface=toast",
    { waitUntil: "domcontentloaded" },
  )
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("paldo-library", 1)
        req.onupgradeneeded = () => {
          const d = req.result
          d.createObjectStore("folders", { keyPath: "id" })
          d.createObjectStore("files", { keyPath: "id" }).createIndex(
            "folderId",
            "folderId",
          )
          d.createObjectStore("decks", { keyPath: "fileId" })
          d.createObjectStore("quizzes", { keyPath: "fileId" })
        }
        req.onsuccess = () => {
          const d = req.result,
            tx = d.transaction(["folders", "decks"], "readwrite")
          tx.objectStore("folders").put({
            id: "fixture-folder",
            name: "Preserve me",
            createdAt: 1,
            style: { tone: "class", pattern: "lines", tab: 0 },
          })
          tx.objectStore("decks").put({
            fileId: "fixture-file",
            cards: [
              { id: "1", front: "A", back: "Alpha" },
              { id: "2", front: "B", back: "Beta" },
            ],
            source: "app",
            madeAt: 1,
          })
          tx.oncomplete = () => {
            d.close()
            resolve()
          }
        }
        req.onerror = () => reject(req.error)
      }),
  )
  const url =
    "http://localhost:8443/scripts/fixtures/adaptive-ui.html?surface=cards"
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Reveal flashcard answer", exact: true }).click()
  await page.getByRole("button", { name: "Not yet", exact: true }).click()
  await page.getByRole("button", { name: "Reveal flashcard answer", exact: true }).click()
  await page.getByRole("button", { name: "I knew it", exact: true }).click()
  await page.getByRole("button", { name: "Reveal flashcard answer", exact: true }).click()
  await page.getByRole("button", { name: "Not yet", exact: true }).click()
  await page.getByRole("heading", { name: "Round complete" }).waitFor()
  assert.equal(await page.getByRole('tablist',{name:'Practice mode'}).count(),0)
  await page.reload({waitUntil:'domcontentloaded'})
  const flip=page.getByRole('button',{name:'Reveal flashcard answer',exact:true})
  await flip.click();assert.equal(await page.locator('.flip').getAttribute('data-flipped'),'true')
  await page.getByRole('button',{name:'Show flashcard question',exact:true}).click()
  assert.equal(await page.locator('.flip').getAttribute('data-flipped'),'false')
  await page.getByRole('button',{name:'Reveal flashcard answer',exact:true}).press('Enter')
  await page.getByRole('button',{name:'Show flashcard question',exact:true}).press('ArrowRight')
  await page.waitForFunction(()=>document.querySelector('.flip')?.getAttribute('data-flipped')==='false')
  const result=await page.evaluate(async()=>{const lib=await import('/src/lib/library.ts');return {progress:await lib.getCardProgress('fixture-file'),folders:await lib.listFolders()}})
  assert.equal(result.folders[0].name,'Preserve me');assert.equal(result.progress.find(p=>p.key.includes('Alpha')).attempts,3)
  console.log(
    "card UI: v1 migration, saved swipe progress, tap flip, bounded misses, keyboard answering and reload pass",
  )
} finally {
  await browser.close()
}
