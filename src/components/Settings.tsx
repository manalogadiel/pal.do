import WeatherSettings from './WeatherSettings'
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { PalId } from "../lib/core"
import type { Energy } from "../lib/schedule"
import { Pal, PALS } from "../pals/Pal"
import {
  Check,
  ChevronL,
  ChevronR,
  Clock,
  Doc,
  Gear,
  Mic,
  Moon,
  Speaker,
  X,
} from "./Icons"
import { HandsFreeRow, LocalAiRow, ResetRow } from "./Overlays"
import AiModeSelector from "./AiModeSelector"
import AndroidAiSettings from "./AndroidAiSettings"
import { isPhoneAiPlatform } from "../lib/ai-mode"
import {
  CLOUD_MODELS,
  getCloudModel,
  getSavedGroqKey,
  isGroqDisabled,
  setCloudModel,
  setGroqApiKey,
  setGroqDisabled,
} from "../lib/groq"
import {
  playSound,
  setSoundsOn,
  soundsOn,
  testAlarm,
} from "../lib/notifications"

export interface SettingsValues {
  pal: PalId
  name: string
  energy: Energy
  userName?: string
  advancedMode?: boolean
  voiceOn: boolean
  notify: boolean
  sttDeviceOnly?: boolean
}
const sections = [
  {id:"weather",label:"Location & weather",description:"Your area and hourly forecasts",icon:Clock},
  {
    id: "profile",
    label: "You & your Pal",
    description: "Your name, companion and focus time",
    icon: Gear,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Light and dark themes",
    icon: Moon,
  },
  {
    id: "voice",
    label: "Voice & sound",
    description: "Spoken replies and hands-free listening",
    icon: Speaker,
  },
  {
    id: "ai",
    label: "AI & models",
    description: "How Pal answers you",
    icon: Mic,
  },
  {
    id: "reminders",
    label: "Reminders",
    description: "Permissions and alarm checks",
    icon: Clock,
  },
  {
    id: "data",
    label: "Data & privacy",
    description: "Your preferences and device data",
    icon: Doc,
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Diagnostics and sample calendar",
    icon: Gear,
  },
] as const
type Section = typeof sections[number]["id"]

function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="min-w-0">
        <div className="settings-label">{title}</div>
        {description && <p className="settings-help">{description}</p>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  )
}
function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="settings-switch-target"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={`settings-switch ${checked ? "is-on" : ""}`}>
        <span />
      </span>
    </button>
  )
}
function CloudSettings() {
  const [key, setKey] = useState(getSavedGroqKey)
  const [model, setModel] = useState(getCloudModel)
  const [enabled, setEnabled] = useState(() => !isGroqDisabled())
  return (
    <details className="settings-details">
      <summary>
        Advanced AI controls
        <ChevronR />
      </summary>
      <div className="settings-details-content">
        {!isPhoneAiPlatform() && (
          <Row title="Cloud AI" description="Allow Pal to use online models.">
            <Switch
              label="Cloud AI"
              checked={enabled}
              onChange={(v) => {
                setEnabled(v)
                setGroqDisabled(!v)
              }}
            />
          </Row>
        )}
        <label className="settings-field-label" htmlFor="settings-cloud-model">
          Cloud model
        </label>
        <select
          id="settings-cloud-model"
          className="settings-input"
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setCloudModel(e.target.value)
          }}
        >
          <option value="auto">Auto · best available</option>
          {CLOUD_MODELS.filter((m) => !key || m.id !== "gemini").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="settings-field-label mt-5" htmlFor="settings-api-key">
          Your Groq API key{" "}
          <span className="font-normal text-ink-2">(optional)</span>
        </label>
        <input
          id="settings-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="settings-input"
          placeholder="gsk_…"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setGroqApiKey(e.target.value)
          }}
        />
        <p className="settings-help mt-2">
          Stored on this device and used for your cloud requests.{" "}
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            Get a Groq key
          </a>
        </p>
        {!isPhoneAiPlatform() && (
          <div className="settings-embedded">
            <LocalAiRow />
          </div>
        )}
      </div>
    </details>
  )
}

export default function SettingsScreen({
  settings,
  onChange,
  onClose,
  dark,
  onTheme,
  prefsLabel,
  onClearPrefs,
  handsFree,
  onEnableReminders,
  onSyllabus,
  onDemoWeek,
}: {
  settings: SettingsValues
  onChange: (patch: Partial<SettingsValues>) => void
  onClose: () => void
  dark: boolean
  onTheme: (dark: boolean) => void
  prefsLabel?: string
  onClearPrefs: () => void
  handsFree?: {
    on: boolean
    deviceOnly: boolean
    setDeviceOnly: (value: boolean) => void
  }
  onEnableReminders: () => Promise<boolean>
  onSyllabus: () => void
  onDemoWeek: () => void
}) {
  const [section, setSection] = useState<Section | null>(null)
  const [sound, setSound] = useState(soundsOn)
  const [alarmTesting, setAlarmTesting] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState("")
  const [confirmDemo, setConfirmDemo] = useState(false)
  const [nickname, setNickname] = useState(settings.userName ?? "")
  const pendingNickname = useRef<string | null>(null)
  const nicknameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const change = useRef(onChange)
  change.current = onChange
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const alarmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const selected = sections.find((s) => s.id === (section ?? "profile"))!
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    element?.showModal()
    return () => {
      document.body.style.overflow = oldOverflow
      clearTimeout(alarmTimer.current)
      clearTimeout(nicknameTimer.current)
      if (pendingNickname.current !== null)
        change.current({
          userName: pendingNickname.current.trim() || undefined,
        })
      element?.close()
      previous?.focus()
    }
  }, [])
  function saveNickname() {
    clearTimeout(nicknameTimer.current)
    if (pendingNickname.current !== null) {
      change.current({ userName: pendingNickname.current.trim() || undefined })
      pendingNickname.current = null
    }
  }
  const navigate = (id: Section | null) => {
    setSection(id)
    setNotice("")
    setConfirmDemo(false)
    content.current?.scrollTo(0, 0)
    requestAnimationFrame(() =>
      id
        ? heading.current?.focus()
        : dialog.current
            ?.querySelector<HTMLButtonElement>("[data-category]")
            ?.focus(),
    )
  }
  async function enableReminders() {
    setRequesting(true)
    setNotice("")
    try {
      const granted = await onEnableReminders()
      setNotice(
        granted
          ? "Reminders are enabled."
          : "Notifications are blocked. Allow them in your browser or device settings, then try again.",
      )
    } catch {
      setNotice(
        "Could not enable reminders. Check your device permissions and try again.",
      )
    } finally {
      setRequesting(false)
    }
  }
  async function checkAlarm() {
    setAlarmTesting(true)
    setNotice("")
    try {
      const scheduled = await testAlarm(settings.name, 5)
      if (!scheduled) {
        setAlarmTesting(false)
        setNotice(
          "Allow notifications in your browser or device settings to test an alarm.",
        )
        return
      }
      alarmTimer.current = setTimeout(() => setAlarmTesting(false), 5500)
    } catch {
      setAlarmTesting(false)
      setNotice(
        "Could not schedule the alarm. Check notification permissions and try again.",
      )
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`settings-dialog ${section ? "settings-has-section" : ""}`}
      aria-labelledby="settings-title"
      onCancel={onClose}
    >
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h1 id="settings-title">Settings</h1>
            <p>Make Pal.do feel like you.</p>
          </div>
          <button
            type="button"
            className="settings-icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings categories">
            <div className="settings-nav-items">
              {sections.map(({ id, label, description, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  data-category
                  className={`settings-nav-item ${
                    selected.id === id ? "is-selected" : ""
                  }`}
                  aria-current={selected.id === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon className="size-[18px] shrink-0" />
                  <span>
                    <span className="settings-nav-label">{label}</span>
                    <span className="settings-nav-description">
                      {description}
                    </span>
                  </span>
                  <ChevronR className="settings-nav-chevron size-4" />
                </button>
              ))}
            </div>
            <div className="settings-nav-footer">
              <Pal id={settings.pal} size={44} state="idle" />
              <span>
                Here with {settings.name}
                <small>Your everyday companion</small>
              </span>
            </div>
          </nav>
          <div ref={content} className="settings-content">
            <button
              type="button"
              className="settings-back"
              onClick={() => navigate(null)}
            >
              <ChevronL />
              All settings
            </button>
            {selected.id==='weather'&&<WeatherSettings/>}
            <div className="settings-section-heading">
              <h2 ref={heading} tabIndex={-1}>
                {selected.label}
              </h2>
              <p>{selected.description}.</p>
            </div>
            {selected.id === "profile" && (
              <>
                <div className="settings-profile">
                  <Pal id={settings.pal} size={84} state="idle" />
                  <div>
                    <h3>{settings.name} is your Pal.</h3>
                    <p>A little company for your day.</p>
                  </div>
                </div>
                <label
                  className="settings-field-label"
                  htmlFor="settings-nickname"
                >
                  What should Pal call you?
                </label>
                <input
                  id="settings-nickname"
                  className="settings-input"
                  autoComplete="given-name"
                  maxLength={30}
                  placeholder="Your name or nickname"
                  value={nickname}
                  onBlur={saveNickname}
                  onChange={(e) => {
                    setNickname(e.target.value)
                    pendingNickname.current = e.target.value
                    clearTimeout(nicknameTimer.current)
                    nicknameTimer.current = setTimeout(saveNickname, 500)
                  }}
                />
                <p className="settings-help mt-2">
                  Optional. Pal uses this name in your conversations.
                </p>
                <fieldset className="settings-fieldset">
                  <legend>Choose your Pal</legend>
                  <div className="settings-pals">
                    {(Object.keys(PALS) as PalId[]).map((id) => (
                      <button
                        type="button"
                        aria-pressed={settings.pal === id}
                        key={id}
                        onClick={() =>
                          onChange({ pal: id, name: PALS[id].name })
                        }
                      >
                        <Pal id={id} size={56} state="idle" />
                        <span>{PALS[id].name}</span>
                        {settings.pal === id && (
                          <Check className="settings-pal-check size-3.5" />
                        )}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="settings-fieldset">
                  <legend>When do you focus best?</legend>
                  <div className="settings-segments">
                    {(["morning", "afternoon", "evening"] as Energy[]).map(
                      (value) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={settings.energy === value}
                          onClick={() => onChange({ energy: value })}
                        >
                          {value}
                        </button>
                      ),
                    )}
                  </div>
                </fieldset>
              </>
            )}
            {selected.id === "appearance" && (
              <>
                <fieldset className="settings-fieldset mt-0">
                  <legend>Theme</legend>
                  <div className="settings-theme-options">
                    {[false, true].map((value) => (
                      <button
                        type="button"
                        key={String(value)}
                        aria-pressed={dark === value}
                        onClick={() => onTheme(value)}
                      >
                        <span
                          className={`settings-theme-preview ${
                            value ? "is-dark" : ""
                          }`}
                          aria-hidden
                        >
                          <span />
                          <span>
                            <i />
                            <i />
                            <i />
                          </span>
                        </span>
                        <span>
                          {value ? "Dark" : "Light"}
                          {dark === value && <Check />}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <p className="settings-help mt-4">
                  Applies across your calendar, study tools and conversations.
                </p>
              </>
            )}
            {selected.id === "voice" && (
              <>
                <Row
                  title="Spoken replies"
                  description={`Hear ${settings.name}'s replies aloud.`}
                >
                  <Switch
                    label="Spoken replies"
                    checked={settings.voiceOn}
                    onChange={(voiceOn) => onChange({ voiceOn })}
                  />
                </Row>
                <Row
                  title="Interface sounds"
                  description="Soft sounds for messages and new plans. Timers and reminders still ring."
                >
                  <Switch
                    label="Interface sounds"
                    checked={sound}
                    onChange={(v) => {
                      setSound(v)
                      setSoundsOn(v)
                      if (v) playSound("added")
                    }}
                  />
                </Row>
                {handsFree && (
                  <div className="settings-embedded">
                    <HandsFreeRow palName={settings.name} {...handsFree} showDiagnostics={!!settings.advancedMode} />
                  </div>
                )}
              </>
            )}
            {selected.id === "ai" && (
              <>
                <div className="settings-embedded">
                  {isPhoneAiPlatform() ? (
                    <AndroidAiSettings />
                  ) : (
                    <AiModeSelector />
                  )}
                </div>
                <p className="settings-help mt-5">
                  Choose how Pal responds. Auto switches between available
                  options for you.
                </p>
                <CloudSettings />
              </>
            )}
            {selected.id === "reminders" && (
              <>
                <Row
                  title="Calendar reminders"
                  description={
                    settings.notify
                      ? "Notifications are enabled for your planned events."
                      : "Allow notifications for your planned events."
                  }
                >
                  {settings.notify ? (
                    <span className="settings-enabled">
                      <Check />
                      Enabled
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="settings-button"
                      disabled={requesting}
                      onClick={() => void enableReminders()}
                    >
                      {requesting ? "Requesting…" : "Enable"}
                    </button>
                  )}
                </Row>
                <Row
                  title="Test an alarm"
                  description="Schedule a test to ring in five seconds."
                >
                  <button
                    type="button"
                    className="settings-button"
                    disabled={alarmTesting || requesting}
                    onClick={() => void checkAlarm()}
                  >
                    {alarmTesting ? "Ringing in 5s…" : "Test alarm"}
                  </button>
                </Row>
                <p className="settings-help mt-5">
                  Device permissions, silent mode and battery settings can
                  affect notifications.
                </p>
              </>
            )}
            {selected.id === "data" && (
              <>
                <div className="settings-copy">
                  <h3>Kept on this device</h3>
                  <p>
                    Your calendar, tasks, study files, chats and preferences are
                    stored locally. When cloud AI is used, relevant conversation
                    and schedule context is sent to answer your request.
                  </p>
                </div>
                <Row
                  title="Remembered preferences"
                  description={
                    prefsLabel || "No scheduling preferences remembered yet."
                  }
                >
                  {prefsLabel && (
                    <button
                      type="button"
                      className="settings-button"
                      onClick={onClearPrefs}
                    >
                      Clear
                    </button>
                  )}
                </Row>
                <Row
                  title="Import syllabus"
                  description="Paste a course outline to find deadlines."
                >
                  <button
                    type="button"
                    className="settings-button"
                    onClick={onSyllabus}
                  >
                    Open
                  </button>
                </Row>
                <div className="settings-danger settings-embedded">
                  <ResetRow />
                </div>
              </>
            )}
            {selected.id === "advanced" && (
              <>
                <Row
                  title="Show diagnostics"
                  description="Display the active AI model, connection status and response time."
                >
                  <Switch
                    label="Show diagnostics"
                    checked={!!settings.advancedMode}
                    onChange={(advancedMode) => onChange({ advancedMode })}
                  />
                </Row>
                <Row
                  title="Sample week"
                  description="Replace your calendar with sample events and tasks."
                >
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => setConfirmDemo(!confirmDemo)}
                  >
                    Load sample
                  </button>
                </Row>
                {confirmDemo && (
                  <div className="settings-confirm" role="alert">
                    <p>
                      This replaces your current calendar and tasks. Continue?
                    </p>
                    <div>
                      <button
                        type="button"
                        className="settings-button"
                        onClick={() => setConfirmDemo(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="settings-button settings-destructive"
                        onClick={onDemoWeek}
                      >
                        Replace with sample
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {notice && (
              <p className="settings-notice" role="status">
                {notice}
              </p>
            )}
            <footer className="settings-save-note">
              <Check className="size-3.5" /> Changes save automatically on this
              device.
            </footer>
          </div>
        </div>
      </div>
    </dialog>
  )
}
