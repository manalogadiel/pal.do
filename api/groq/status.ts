import { cloudStatus } from '../_lib/proxy.js'

export const GET = (req: Request) => cloudStatus(req)
