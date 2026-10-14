# Pal.do

> **Your AI student and productivity companion**

Pal.do helps students and professionals balance classes, shifts, exams, and study blocks with an intelligent schedule assistant, interactive timers, hands-free voice companions, and offline study tools.

## Key Features

- **Class Schedule Import**: Extract schedules directly from images, PDFs (via PDF.js), and DOCX files into calendar events.
- **AI Voice Companions**: Four unique personas (Rei, Diel, Jhyvie, Jaypee) with natural speech recognition, on-device wakeword detection, and hands-free interactions.
- **Focus & Study Tools**: Pomodoro (25m/5m), 52/17 rhythm, Flowtime, Eat the Frog, flashcard practice, and distraction bins.
- **Calendar & Task Management**: Intelligent week planner, conflict detection, routine organizer, and smart commute/travel planner.
- **Offline & Mobile Support**: PWA with Service Worker caching and Capacitor Android mobile app integration with on-device AI.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

The application runs locally on `http://localhost:8443` with cross-origin isolation enabled for on-device WebAssembly speech models.

### Production Build

```bash
pnpm build
```

## Tech Stack

- **Framework**: React 19 + TypeScript + Vite 8
- **Styling**: Tailwind CSS v4
- **Mobile**: Capacitor 8 (Android)
- **AI & Speech**: Groq Cloud AI, Gemini Vision, Web Speech API / Edge Neural TTS, Kokoro JS, WebAssembly ONNX Runtime, and VAD Web
- **Document Processing**: PDF.js, Mammoth.js

## License

Private repository. All rights reserved.
