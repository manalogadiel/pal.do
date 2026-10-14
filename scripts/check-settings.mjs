import { createServer } from "vite"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
const server = await createServer({
  configLoader: "runner",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
})
try {
  const { default: SettingsScreen } = await server.ssrLoadModule(
    "/src/components/Settings.tsx",
  )
  const html = renderToStaticMarkup(
    React.createElement(SettingsScreen, {
      settings: {
        pal: "rei",
        name: "Rei",
        energy: "afternoon",
        userName: "Pat",
        voiceOn: false,
        notify: false,
      },
      onChange: () => {},
      onClose: () => {},
      dark: false,
      onTheme: () => {},
      onEnableReminders: async () => false,
      onSyllabus: () => {},
      onDemoWeek: () => {},
      onClearPrefs: () => {},
    }),
  )
  for (const category of [
    "You &amp; your Pal",
    "Appearance",
    "Voice &amp; sound",
    "AI &amp; models",
    "Reminders",
    "Data &amp; privacy",
    "Advanced",
  ])
    assert.ok(html.includes(category), category)
  assert.ok(html.includes('value="Pat"'), "Uses the saved nickname")
  assert.ok(
    html.includes('aria-label="Settings categories"'),
    "Named category navigation",
  )
  assert.ok(html.includes("Close settings"), "Accessible close action")
  assert.ok(
    !html.includes("Save Changes") && !html.includes("A few ground rules"),
    "Settings is separate from onboarding",
  )
  console.log(
    "settings: categories, saved profile, accessible navigation, and dedicated screen pass",
  )
} finally {
  await server.close()
}
