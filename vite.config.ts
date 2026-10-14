import {maps} from './api/_lib/maps'
import {scheduleExtract} from './api/_lib/schedule-extract'
import { OPTIONS as ttsOptions, POST as ttsPost } from './api/tts'
import {MAX_SCHEDULE_REQUEST} from './src/lib/schedule-source'
import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const configDirectory = path.dirname(fileURLToPath(import.meta.url))

const defaultSiteConfig: FigmaSiteConfiguration = {
  title: 'Pal.do',
  description: 'Your AI student and productivity companion',
  robots: { index: false },
  accessibility: { addBypassLinks: false, ignoreReducedMotion: false },
}
let siteConfiguration: FigmaSiteConfiguration = defaultSiteConfig
try {
  const siteConfigPath = path.resolve(configDirectory, '.figma/make/site.json')
  if (fs.existsSync(siteConfigPath)) {
    siteConfiguration = JSON.parse(fs.readFileSync(siteConfigPath, 'utf-8'))
  }
} catch {}


/**
 * Cross-origin isolation: lets on-device speech-to-text use every CPU core (multithreaded WebAssembly), so hands-free
 * hears "Hi {pal}" and shows live words several times faster. Same headers in vercel.json for the deployed app.
 */
const ISOLATION_HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
/** The same headers from middleware too: server.headers alone was lost once after Vite restarted itself */
function crossOriginIsolation(): Plugin {
  const add = (_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v)
    next()
  }
  return { name: 'cross-origin-isolation', configureServer: (s) => { s.middlewares.use(add) }, configurePreviewServer: (s) => { s.middlewares.use(add) } }
}

function localMaps():Plugin{return{name:'local-maps',configureServer(server){server.middlewares.use('/api/maps',async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const request=new Request('http://localhost:8443/api/maps',{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks).toString()}: {})});const result=await maps(request);res.statusCode=result.status;result.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await result.text())})}}}

/**
 * Pal's Edge voice on the dev server too: /tts runs the same function the deployed site uses (api/tts.ts), so the
 * voice is on by default with nothing else to start
 */
function localTts(): Plugin {
  return {
    name: 'local-edge-tts',
    configureServer(server) {
      server.middlewares.use('/tts', async (req, res, next) => {
        if (req.method !== 'POST' && req.method !== 'OPTIONS') return next()
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (req.headers.origin) headers.Origin = req.headers.origin
          const request = new Request(`http://${req.headers.host}/tts`, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString() } : {}) })
          const result = await (req.method === 'POST' ? ttsPost(request) : ttsOptions(request))
          res.statusCode = result.status
          result.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await result.arrayBuffer()))
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

function localScheduleExtraction(key: string): Plugin {
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use('/api/schedule-extract', async (req, res) => {
      try {
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk); size += buffer.length
          if (size > MAX_SCHEDULE_REQUEST) { res.statusCode = 413; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Prepared request exceeds 4.5 MB. Select fewer pages.' })); return }
          chunks.push(buffer)
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value)
        const request = new Request(`http://${req.headers.host ?? 'localhost:8443'}/api/schedule-extract`, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString() } : {}) })
        const response = await scheduleExtract(request, key)
        res.statusCode = response.status; response.headers.forEach((value, name) => res.setHeader(name, value)); res.end(await response.text())
      } catch { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Extraction failed. Retry or enter classes manually.' })) }
    })
  }
  return { name: 'local-schedule-extraction', configureServer: configure, configurePreviewServer: configure }
}

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, configDirectory, '')
  const androidPreview = mode === 'android-preview'
  // .figma/make/deploy-preview passes `--mode development` for cached-preview builds.
  const emitSourcemaps = mode === 'development'

  return {
    publicDir: 'public',
    cacheDir: '.cache/vite',
    base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : '/',
    build: {
      outDir: androidPreview ? 'dist-android' : 'dist',
      sourcemap: emitSourcemaps ? 'inline' : false,
      minify: !emitSourcemaps,
    },
    plugins: [
      crossOriginIsolation(),
      localMaps(),
      localTts(),
      localScheduleExtraction(process.env.GEMINI_API_KEY ?? serverEnv.GEMINI_API_KEY ?? ''),
      react(),
      tailwindcss(),
      figmaSiteConfiguration(siteConfiguration),
      figmaErrorOverlayReplay(),
      figmaReactRefreshBoundaryFallback(),
      figmaMakeKitPlugin({ storiesGlob: '/src/**/*.stories.{ts,tsx,js,jsx}' }),
      pruneUnusedModels(androidPreview ? 'dist-android' : 'dist'),
    ],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(configDirectory, './src') },
        // self-contained browser build (the package's default entry imports node's fs/path)
        { find: 'kokoro-web', replacement: path.resolve(configDirectory, './node_modules/kokoro-js/dist/kokoro.web.js') },
        // Hands-free voice detection asks for ONNX's plain-wasm build; give it the full one Kokoro and Whisper already
        // ship in /public/kokoro/ort, so the app carries one runtime instead of two (saves ~11MB)
        { find: /^onnxruntime-web\/wasm$/, replacement: 'onnxruntime-web' },
      ],
    },
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['kokoro-js', 'kokoro-web'] },
    server: {
      headers: ISOLATION_HEADERS,
      host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
      strictPort: true,
      watch: {
        ignored: [
          '**/.figma/**',
          '**/.cache/**',
          '**/android/**',
          '**/dist/**',
          '**/dist-android/**',
        ],
      },
    },
    preview: {
      headers: ISOLATION_HEADERS,
      host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
    },
  }
})

/**
 * Builds ship only the voice files the app loads from its own server: the voice detector (vad/), the wake-word
 * engine (wakeword/, ~6 MB), the ONNX runtime (kokoro/ort/) and, on the web, Whisper (whisper/, 76 MB): fetched from
 * Hugging Face instead it took minutes ("Getting ready… 15%") where the dev server loads it in seconds. The Android
 * app leaves Whisper out to stay small and downloads it the first time (stt.worker.ts falls back to Hugging Face).
 * The Kokoro speech model was never used for speaking, and the bundler's second copy of the ONNX runtime is never
 * loaded either (paths point at kokoro/ort/). The dev server still serves all of public/.
 */
function pruneUnusedModels(outDir: string): Plugin {
  return {
    name: 'paldo-prune-unused-models',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(configDirectory, outDir)
      for (const dir of [...(outDir === 'dist-android' ? ['whisper'] : []), 'kokoro/models', 'kokoro/voices']) fs.rmSync(path.join(out, dir), { recursive: true, force: true })
      const assets = path.join(out, 'assets')
      if (fs.existsSync(assets)) for (const f of fs.readdirSync(assets)) if (/^ort-wasm.*\.wasm$/.test(f)) fs.rmSync(path.join(assets, f))
    },
  }
}

type FigmaSiteConfiguration = {
  title?: string
  description?: string
  language?: string
  robots?: {
    index?: boolean
  }
  icons?: {
    icon?: string
  }
  openGraph?: {
    image?: string
  }
  analytics?: {
    googleAnalyticsId?: string
  }
  customScripts?: {
    headStart?: string
    headEnd?: string
    bodyStart?: string
    bodyEnd?: string
  }
  accessibility?: {
    addBypassLinks?: boolean
  }
}

/** Applies /.figma/make/site.json to the generated document shell. */
function figmaSiteConfiguration(config: FigmaSiteConfiguration): Plugin {
  function sanitizeHtmlValue(value: string | undefined): string {
    return value?.replace(/[^a-zA-Z0-9_-]/g, '') || ''
  }
  function escapeHtmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function replaceHtmlCommentSlot(html: string, slotName: string, content: string): string {
    return html.replace(`<!-- ${slotName} -->`, content)
  }

  const title = config.title ?? "Pal.do"
  const description = config.description ?? ''
  const favicon = config.icons?.icon ?? ''
  const socialImage = config.openGraph?.image ?? ''
  const language = sanitizeHtmlValue(config.language) || 'en'
  const googleAnalyticsId = sanitizeHtmlValue(config.analytics?.googleAnalyticsId)
  const headStart = config.customScripts?.headStart ?? ''
  const headEnd = config.customScripts?.headEnd ?? ''
  const bodyStart = config.customScripts?.bodyStart ?? ''
  const bodyEnd = config.customScripts?.bodyEnd ?? ''
  const robotsTxt = config.robots?.index === false ? 'User-agent: *\nDisallow: /\n' : ''

  return {
    name: 'figma-site-configuration',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!robotsTxt || req.url?.split('?')[0] !== '/robots.txt') return next()

        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(robotsTxt)
      })
    },
    generateBundle() {
      if (!robotsTxt) return

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robotsTxt,
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let result = html
        result = replaceHtmlCommentSlot(result, 'figma:lang', language)
        result = result.includes('<!-- figma:title -->')
          ? replaceHtmlCommentSlot(result, 'figma:title', escapeHtmlText(title))
          : result.replace(/<title>.*?<\/title>/i, `<title>${escapeHtmlText(title)}</title>`)
        result = replaceHtmlCommentSlot(result, 'figma:head-start', headStart)
        result = replaceHtmlCommentSlot(result, 'figma:head-end', headEnd)
        result = replaceHtmlCommentSlot(result, 'figma:body-start', bodyStart)
        result = replaceHtmlCommentSlot(result, 'figma:body-end', bodyEnd)

        const tags: HtmlTagDescriptor[] = []
        if (description) {
          tags.push({ tag: 'meta', attrs: { name: 'description', content: description }, injectTo: 'head' })
        }
        if (config.robots?.index === false) {
          tags.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' })
        }
        if (favicon) {
          tags.push({ tag: 'link', attrs: { rel: 'icon', href: favicon }, injectTo: 'head' })
        }
        if (title) {
          tags.push({ tag: 'meta', attrs: { property: 'og:title', content: title }, injectTo: 'head' })
        }
        if (description) {
          tags.push({ tag: 'meta', attrs: { property: 'og:description', content: description }, injectTo: 'head' })
        }
        if (socialImage) {
          tags.push(
            { tag: 'meta', attrs: { property: 'og:image', content: socialImage }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:image', content: socialImage }, injectTo: 'head' },
          )
        }

        if (googleAnalyticsId) {
          tags.push(
            {
              tag: 'script',
              attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`,
              },
              injectTo: 'head',
            },
            {
              tag: 'script',
              children: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(googleAnalyticsId)});
`,
              injectTo: 'head',
            },
          )
        }

        if (config.accessibility?.addBypassLinks) {
          tags.push(
            {
              tag: 'style',
              children: `
  .figma-bypass-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 2147483647;
    transform: translateY(-150%);
    border-radius: 6px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    font: 600 14px/1.2 system-ui, sans-serif;
    text-decoration: none;
  }
  .figma-bypass-link:focus {
    transform: translateY(0);
  }
`,
              injectTo: 'head',
            },
            {
              tag: 'a',
              attrs: { class: 'figma-bypass-link', href: '#root' },
              children: 'Skip to content',
              injectTo: 'body-prepend',
            },
          )
        }

        return {
          html: result,
          tags,
        }
      },
    },
  }
}

/**
 * Replay the most recent build error to clients that connect after
 * it was first broadcast. Vite buffers an error payload only while
 * no clients are connected and clears the buffer on the first
 * reconnect (see `bufferedMessage` in `createWebSocketServer`), so
 * if the preview iframe reloads after Vite already delivered an
 * error to a live socket, the new socket misses the payload and
 * the overlay stays hidden even though the build is still broken.
 * We intercept `ws.send` to remember the latest error and replay
 * it on every new connection; the cache clears on a successful
 * `update` or `full-reload` so a stale overlay can't survive a
 * fixed build.
 */
function figmaErrorOverlayReplay(): Plugin {
  return {
    name: 'figma-error-overlay-replay',
    apply: 'serve',
    configureServer(server) {
      let lastError: object | null = null

      const origSend = server.ws.send.bind(server.ws) as (...args: any[]) => void
      server.ws.send = ((...args: any[]) => {
        const payload = args[0]
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const type = (payload as { type?: string }).type
          if (type === 'error') {
            lastError = payload as object
          } else if (type === 'update' || type === 'full-reload') {
            lastError = null
          }
        }
        return origSend(...args)
      }) as typeof server.ws.send

      server.ws.on('connection', (socket) => {
        if (lastError !== null) {
          socket.send(JSON.stringify(lastError))
        }
      })
    },
  }
}

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when an agent moves a component into a new file
 * and replaces the old module with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function figmaReactRefreshBoundaryFallback(): Plugin {
  const hadRefreshBoundary = new Map<string, boolean>()
  let sendFullReload: (() => void) | null = null

  return {
    name: 'figma-react-refresh-boundary-fallback',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: 'full-reload', path: '*' })
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null

      const moduleId = id.split('?')[0] ?? id
      const hasRefreshBoundary = code.includes('registerExportsForReactRefresh')
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId)
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary)

      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        queueMicrotask(() => sendFullReload?.())
      }

      return null
    },
  }
}

/**
 * Serves a blank render-target page at /.figma/make/kit.html that
 * the Figma preview script drives directly. The page exposes a
 * registry of every file matching `storiesGlob` on
 * window.__FIGMA__.stories so the design surface can dynamically
 * import + mount each entry into its own grid view.
 *
 * Dev-only: `apply: 'serve'` gates the plugin to `vite dev`. Prod
 * builds (`vite build`) skip it entirely so the route doesn't leak
 * into shipped bundles.
 */
function figmaMakeKitPlugin(options: { storiesGlob: string | string[] }): Plugin {
  const storiesGlob = Array.isArray(options.storiesGlob) ? options.storiesGlob : [options.storiesGlob]
  const ROUTE = '/.figma/make/kit.html'
  const VIRTUAL_ID = 'virtual:figma-stories'
  const RESOLVED_ID = '\0' + VIRTUAL_ID
  const STORIES_MODULE = `export const stories = import.meta.glob(${JSON.stringify(storiesGlob)})`
  const HTML_BOOTSTRAP = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
<div id="figma-make-kit-root"></div>
<script type="module">
  import { stories } from 'virtual:figma-stories'
  window.__FIGMA__ = Object.assign(window.__FIGMA__ ?? {}, { stories })
  window.dispatchEvent(new CustomEvent('figma.ready'))
</script>
</body>
</html>`

  return {
    name: 'figma-make-kit',
    apply: 'serve',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      return STORIES_MODULE
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (url.split('?')[0] !== ROUTE) return next()

        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(url, HTML_BOOTSTRAP))
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}
