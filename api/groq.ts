// POST /api/groq: Pal's chat, through the free cloud models. See api/_lib/proxy.ts.
import { chat, preflight } from './_lib/proxy'

export const OPTIONS = (req: Request) => preflight(req)
export const POST = (req: Request) => chat(req)
