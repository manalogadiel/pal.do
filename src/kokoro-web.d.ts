declare module 'kokoro-web' {
  export { KokoroTTS, TextSplitterStream } from 'kokoro-js'
  export const env: { wasmPaths: string }
}
