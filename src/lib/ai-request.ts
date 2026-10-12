export class AiRequestGate {
  private current: AbortController | null = null
  begin() {
    this.cancel()
    const controller = new AbortController()
    this.current = controller
    const isCurrent = () => this.current === controller && !controller.signal.aborted
    return { signal: controller.signal, isCurrent, commit: (effect: () => void) => { if (!isCurrent()) return false; effect(); return true } }
  }
  cancel() { this.current?.abort(); this.current = null }
}
