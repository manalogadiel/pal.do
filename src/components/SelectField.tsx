import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronD } from './Icons'

export interface SelectOption { value: string; label: string; disabled?: boolean }
interface Props extends Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'id' | 'className' | 'disabled' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid' | 'aria-required'> {
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
}

/** Controlled, select-only combobox. Keyboard exploration never commits a value. */
const SelectField = forwardRef<HTMLButtonElement, Props>(function SelectField({ value, options, onValueChange, className = '', disabled, ...label }, ref) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [highlight, setHighlight] = useState(''), [position, setPosition] = useState<CSSProperties>({})
  const search = useRef({ text: '', at: 0 })
  useImperativeHandle(ref, () => trigger.current!, [])
  const nativePopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'
  const selected = options.find(o => o.value === value)
  const active = options.find(o => o.value === highlight && !o.disabled)
  const parent = typeof document === 'undefined' ? null : trigger.current?.closest('dialog') ?? document.body
  const close = () => { setOpen(false); search.current.text = '' }
  const commit = (option: SelectOption) => {
    if (disabled || option.disabled || !options.some(o => o.value === option.value)) return
    close(); trigger.current?.focus({ preventScroll: true })
    if (option.value !== value) onValueChange(option.value)
  }
  const show = () => {
    if (disabled || !options.some(o => !o.disabled)) return
    setHighlight(selected && !selected.disabled ? selected.value : options.find(o => !o.disabled)!.value)
    setOpen(true)
  }
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return
    const list = popup.current, button = trigger.current
    const rect = button.getBoundingClientRect(), dialog = button.closest('dialog')
    // The fallback stays in the modal DOM and within its scrollable bounds; a body portal would be inert.
    const viewport = window.visualViewport
    const visible = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth), bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) }
    const bounds = !nativePopover && dialog ? dialog.getBoundingClientRect() : visible
    const leftEdge = Math.max(visible.left + 8, bounds.left + 8), rightEdge = Math.min(visible.right - 8, bounds.right - 8)
    const topEdge = Math.max(visible.top + 8, bounds.top + 8), bottomEdge = Math.min(visible.bottom - 8, bounds.bottom - 8)
    const width = Math.min(Math.max(rect.width, 180), rightEdge - leftEdge)
    const below = bottomEdge - rect.bottom - 6, above = rect.top - topEdge - 6
    const down = below >= Math.min(280, options.length * 44 + 12) || below >= above
    const maxHeight = Math.max(44, Math.min(320, down ? below : above))
    const left = Math.min(Math.max(leftEdge, rect.left), rightEdge - width)
    const top = down ? rect.bottom + 6 : rect.top - 6
    const origin = !nativePopover && dialog ? { x: bounds.left + dialog.clientLeft - dialog.scrollLeft, y: bounds.top + dialog.clientTop - dialog.scrollTop } : { x: 0, y: 0 }
    setPosition({ position: !nativePopover && dialog ? 'absolute' : 'fixed', left: left - origin.x, top: top - origin.y, width, maxHeight, transform: down ? undefined : 'translateY(-100%)' })
    if (nativePopover) list.showPopover()
    const dismiss = (e: PointerEvent) => { if (!list.contains(e.target as Node) && !button.contains(e.target as Node)) close() }
    const reposition = (e: Event) => { if (e.target instanceof Node && list.contains(e.target)) return; close() }
    const toggle = () => { if (nativePopover && !list.matches(':popover-open')) close() }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    viewport?.addEventListener('resize', reposition)
    viewport?.addEventListener('scroll', reposition)
    list.addEventListener('toggle', toggle)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); viewport?.removeEventListener('resize', reposition); viewport?.removeEventListener('scroll', reposition); list.removeEventListener('toggle', toggle); if (nativePopover && list.matches(':popover-open')) list.hidePopover() }
  }, [open, nativePopover])
  useEffect(() => {
    if (open && (disabled || !options.some(o => !o.disabled) || !active)) close()
  }, [disabled, options, open, active])
  useEffect(() => {
    if (!open || !popup.current || !active) return
    const option = popup.current.querySelector<HTMLElement>(`[data-option-index="${options.indexOf(active)}"]`)
    if (option) { const list = popup.current; if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop; else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight }
  }, [highlight, open, active, options])
  const list = open ? <div ref={popup} id={`${id}-list`} role="listbox" aria-label={label['aria-label']} className="select-popup" popover={nativePopover ? 'auto' : undefined} style={position}>
    {options.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} key={option.value} aria-selected={value === option.value} aria-disabled={option.disabled || undefined} data-option-index={index} data-highlighted={highlight === option.value} className="select-option" onPointerDown={e => e.preventDefault()} onPointerMove={() => { if (!option.disabled) setHighlight(option.value) }} onClick={() => commit(option)}>
      <span>{option.label}</span><Check className={`size-4 shrink-0 ${value === option.value ? '' : 'invisible'}`} />
    </button>)}
  </div> : null
  return <span className="select-field"><button {...label} ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && active ? `${id}-option-${options.indexOf(active)}` : undefined} disabled={disabled || !options.some(o => !o.disabled)} className={`select-trigger ${className}`} onClick={() => open ? close() : show()} onKeyDown={e => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { close(); return }
    if (['Enter', ' '].includes(e.key)) { e.preventDefault(); if (open && active) commit(active); else show(); return }
    const enabled = options.filter(o => !o.disabled)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); if (!open) { show(); if (e.key === 'End' || e.key === 'Home') setHighlight(enabled[e.key === 'Home' ? 0 : enabled.length - 1]?.value ?? ''); return }
      const index = enabled.findIndex(o => o.value === highlight)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
      setHighlight(enabled[next]?.value ?? ''); return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); const now = Date.now(); search.current.text = now - search.current.at > 700 ? e.key : search.current.text + e.key; search.current.at = now
      const text = search.current.text.toLocaleLowerCase(), match = enabled.find(o => o.label.toLocaleLowerCase().startsWith(text))
      if (match) { if (!open) show(); setHighlight(match.value) }
    }
  }}><span className="select-value">{selected?.label ?? 'Choose an option'}</span><ChevronD className="size-4 shrink-0" /></button>{list && parent && createPortal(list, parent)}</span>
})
export default SelectField
