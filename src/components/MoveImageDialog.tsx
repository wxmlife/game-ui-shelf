import { useEffect, useRef, useState } from 'react'

import type { GameModule, UiImage } from '../domain/models'

interface MoveImageDialogProps {
  image: UiImage
  modules: GameModule[]
  busy: boolean
  error: string | null
  onClose: () => void
  onMove: (targetModuleId: string) => void
}

export function MoveImageDialog({ image, modules, busy, error, onClose, onMove }: MoveImageDialogProps) {
  const [target, setTarget] = useState(image.moduleId)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector('select')?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => { if (busy) dialog.current?.focus() }, [busy])

  return (
    <div className="editor-backdrop" role="dialog" aria-modal="true" aria-label="移动到模块" ref={dialog} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
        if (event.key === 'Tab') {
          if (busy) { event.preventDefault(); return }
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('select:not(:disabled), button:not(:disabled)'))
          const first = controls[0], last = controls[controls.length - 1]
          if (document.activeElement === event.currentTarget) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <form className="editor-card management-dialog" onSubmit={(event) => { event.preventDefault(); if (!busy) onMove(target) }}>
        <h2>移动到模块</h2>
        <p>{image.title} · 移动后追加到目标模块的同名动作流末尾。</p>
        <label><span>目标模块</span><select aria-label="目标模块" value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
          {modules.map((module) => <option key={module.id} value={module.id}>{module.name}{module.id === image.moduleId ? '（当前）' : ''}</option>)}
        </select></label>
        {error && <div className="editor-error" role="alert">{error}</div>}
        <div className="management-dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? '移动中…' : '确认移动'}</button>
        </div>
      </form>
    </div>
  )
}
