# Deploying Pal.do on Vercel (free tiers only)

The web app and its AI proxy deploy together. Users never need their own API key: the proxy (`api/groq.ts`, `api/groq/audio.ts`, logic in `api/_lib/proxy.ts`) holds the keys on the server.

## What runs where

| Piece | Where | Cost |
| --- | --- | --- |
| Web app (`dist/`, about 27 MB) | Vercel static hosting | Free (Hobby) |
| Chat proxy `/api/groq` and voice proxy `/api/groq/audio` | Vercel Functions | Free (Hobby) |
| Chat AI | Groq free models, then Gemini Flash-Lite free tier | Free |
| Hands-free speech-to-text | Groq Whisper free tier, only after "Hi {pal}" | Free |
| Daily allowance per device (optional) | Upstash Redis free tier | Free |
| Whisper model for the wake word (about 76 MB) | Downloaded from Hugging Face on first use, then cached | Free |

## One-time setup

1. **Keys.**
   - Groq: create a free key at [console.groq.com](https://console.groq.com).
   - Gemini (optional): create a free key at [aistudio.google.com](https://aistudio.google.com/apikey).
2. **Import the repo in Vercel.** Framework preset: Vite. `vercel.json` already sets the build command (`pnpm build`) and output (`dist`).
3. **Git LFS.** The voice detector and ONNX runtime (`public/vad`, `public/kokoro/ort`) are LFS files. In Vercel, open Project → Settings → Git and turn on **Git LFS**, then redeploy. Without it those files deploy as tiny pointer files and hands-free won't start. Chat still works.
4. **Environment variables** (Project → Settings → Environment Variables):

   | Name | Value | Required |
   | --- | --- | --- |
   | `GROQ_API_KEY` | your `gsk_…` key | yes |
   | `GEMINI_API_KEY` | your Gemini key | no; adds a second free quota after Groq |
   | `GEMINI_MODEL` | defaults to `gemini-3.1-flash-lite` | no; change it if Google renames the model |
   | `ALLOWED_ORIGINS` | `https://localhost` plus any custom domain, comma-separated | no; the Vercel URL is always allowed, and `https://localhost` is the Android app |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from a free Upstash Redis (Vercel Marketplace → Upstash) | no; without them there is no per-device cap |
   | `PAL_DEVICE_DAILY` | AI replies per device per day, default `40` | no |
   | `PAL_IP_DAILY` | per network per day, default `200` | no |

   **Never** add `VITE_GROQ_API_KEY` to Vercel. Anything starting with `VITE_` ends up inside the app where anyone can read it.
5. **Deploy.** The web build finds the proxy at `/api/groq` on its own; no `VITE_GROQ_PROXY_URL` is needed for the web.

## The Android app

The APK talks to the same proxy. Before building it, put the full URL in `.env.production` (ignored by Git):

```
VITE_GROQ_PROXY_URL=https://<your-project>.vercel.app/api/groq
```

Then run `pnpm android:preview` as usual. Keep `https://localhost` in `ALLOWED_ORIGINS`.

## What "free tiers only" means with many users

Every user shares the same free quota:

- **Groq free:** roughly 200k tokens per model per day, about 100 Pal replies per model, so a few hundred replies a day across the three models.
- **Gemini free:** a few hundred to about a thousand more requests a day. Limits vary by account; check AI Studio.

Pal stretches the quota several ways:

- Timers, reminders, yes/no answers, day/time corrections, overlaps and wrong-name replies are answered by the app's own rules and never reach the cloud.
- The per-device allowance stops one heavy user from using up everyone's day. Turn on Upstash for this.
- When the shared quota runs out, Pal says so once ("simple answers until about …"). Web users then get the rules. **Android users in Auto mode get the AI on their phone.**
- Anyone who wants unlimited use can paste their own free Groq key in Settings. It goes straight to Groq and skips the shared quota.

With more than a few dozen daily users, expect the cloud to run out partway through the day. The app keeps working, just with simpler replies. If that becomes a problem later, the cheapest fix is a paid Groq key on the server: on `gpt-oss-20b`, about $0.0002 per reply. No code change is needed, only the key.

## Checking a deploy

- Open the site and send "hi". The status badge (Settings → Advanced Mode) should read **Auto · Cloud**.
- `curl -X POST https://<app>.vercel.app/api/groq -H "Origin: https://evil.example" -d "{}"` should return **403**.
- Turn on hands-free and say "Hi Rei". The first time, Whisper downloads from Hugging Face; after that it is cached.

## Security notes

- The origin check only stops other websites. A script can still call the proxy directly, which is why the per-device and per-network caps exist. Also set usage alerts in the Groq and Google consoles.
- The proxy only allows Pal's own models, at most 500 output tokens, 32 KB requests and 600 KB audio clips.
- `proxy/groq-worker.js` is the older Cloudflare Worker version of the same proxy (Groq only). Vercel's `api/` replaces it.
