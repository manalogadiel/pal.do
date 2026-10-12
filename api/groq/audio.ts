// POST /api/groq/audio: one spoken command, written out by Whisper. See api/_lib/proxy.ts.
import { audio, preflight } from '../_lib/proxy'

export const OPTIONS = (req: Request) => preflight(req)
export const POST = (req: Request) => audio(req)
