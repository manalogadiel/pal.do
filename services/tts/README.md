# Speech service

Run locally:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py --check-voices
.venv/bin/python server.py
```

From the project root, `pnpm tts:serve` runs this service and `pnpm tts:check` verifies voices after the local virtual environment is installed.

The web dev server proxies `/tts` to localhost port 8788. For a deployed web app or Android build, set `VITE_TTS_URL=https://your-speech-host/tts` before building. Set `TTS_ALLOWED_ORIGINS` on the service to the exact web origin and Android origins (`http://localhost,https://localhost,capacitor://localhost`). Never include a wildcard. The endpoint is public; no secret belongs in a Vite variable.

Deploy this directory as a Docker service behind HTTPS. Set `PORT` to the host's assigned port, and run a `/health` check. Voice discovery is verified at startup and refreshed every five minutes. Unknown or unavailable voices fail closed, allowing the app's local fallback. Test production origin/CORS from both web and Android before release.

Apply request/IP limits at the HTTPS ingress as well as the service. The service limits each directly connected IP to thirty requests a minute, accepts up to eight simultaneous syntheses, times out synthesis after ten seconds, and stores no speech. Behind a reverse proxy, its internal limit is shared by that proxy's connections; the ingress should enforce individual-client limits. Browser CORS is not authentication.

Offline speech uses only identifiable male, local system voices in the correct language. Android engines often omit gender metadata; unknown voices are deliberately not used. If no suitable voice exists, replies stay visible with “Voice unavailable”. Download appropriate local voice data before going offline.

Tests: `python3 -m unittest discover -s . -p 'test_*.py'`.
