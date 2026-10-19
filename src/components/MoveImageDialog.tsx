import { useEffect, useMemo, useRef, useState } from 'react'

import type { GameModule, UiImage } from '../domain/models'

interface MoveImageDialogProps {
  image: UiImage
  modules: GameModule[]
  images: UiImage[]
  busy: boolean
  error: string | null
  onClose: () => void
  onMove: (targetModuleId: string, beforeImageId: string | null) => void
}

function compareImages(a: UiImage, b: UiImage) {
  return a.sequenceOrder - b.sequenceOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export function MoveImageDialog({ image, modules, images, busy, error, onClose, onMove }: MoveImageDialogProps) {
  const [target, setTarget] = useState(image.moduleId)
  const initialNextImageId = useMemo(() => {
    const currentImages = images.filter((item) => item.moduleId === image.moduleId).sort(compareImages)
    const currentIndex = currentImages.findIndex((item) => item.id === image.id)
    return currentImages[currentIndex + 1]?.id ?? ''
  }, [image.id, image.moduleId, images])
  const [beforeImageId, setBeforeImageId] = useState(initialNextImageId)
  const targetImages = useMemo(
    () => images.filter((item) => item.moduleId === target && item.id !== image.id).sort(compareImages),
    [image.id, images, target],
  )
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
      <form className="editor-card management-dialog" onSubmit={(event) => { event.preventDefault(); if (!busy) onMove(target, beforeImageId || null) }}>
        <h2>移动图片</h2>
        <p>{image.title} · 可同时调整所属模块与图片展示顺序。</p>
        <label><span>目标模块</span><select aria-label="目标模块" value={target} disabled={busy} onChange={(event) => {
          setTarget(event.target.value)
          setBeforeImageId(event.target.value === image.moduleId ? initialNextImageId : '')
        }}>
          {modules.map((module) => <option key={module.id} value={module.id}>{module.name}{module.id === image.moduleId ? '（当前）' : ''}</option>)}
        </select></label>
        <label><span>目标位置</span><select aria-label="目标位置" value={beforeImageId} disabled={busy} onChange={(event) => setBeforeImageId(event.target.value)}>
          {targetImages.map((item) => <option key={item.id} value={item.id}>放在「{item.title}」前面</option>)}
          <option value="">放在模块末尾</option>
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
