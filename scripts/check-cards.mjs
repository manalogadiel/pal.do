import { createServer } from "vite"
import assert from "node:assert/strict"
const v = await createServer({
  configLoader: "runner",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
})
try {
  const { cardProgressKey, practiceQueue, answerQueue, quizChoices } =
    await v.ssrLoadModule("/src/lib/card-practice.ts")
  const cards = [
    { id: "1", front: "A", back: "Alpha" },
    { id: "2", front: "B", back: "Beta" },
  ]
  assert.notEqual(
    cardProgressKey("f", cards[0]),
    cardProgressKey("f", { ...cards[0], back: "Changed" }),
  )
  assert.equal(
    practiceQueue("f", cards, [
      { key: cardProgressKey("f", cards[1]), attempts: 2, correct: 0 },
    ])[0],
    1,
  )
  let q = [0, 1]
  q = answerQueue(q, 0, false)
  assert.deepEqual(q, [0, 1, 0])
  assert.deepEqual(answerQueue(q, 2, false), q)
  assert.equal(quizChoices(cards, 0).length, 2)
  assert.equal(quizChoices([cards[0]], 0).length, 0)
  assert.equal(
    quizChoices([cards[0], { ...cards[1], back: "Alpha" }], 0).length,
    0,
  )
  console.log(
    "cards: content identity, missed priority, bounded repeat and distinct quiz answers pass",
  )
} finally {
  await v.close()
}
