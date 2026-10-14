import { useEffect, useRef, useState } from 'react'

interface DeleteConfirmDialogProps {
  count: number
  gameName?: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmDialog({ count, gameName, busy, error, onClose, onConfirm }: DeleteConfirmDialogProps) {
  const [name, setName] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const canConfirm = !busy && (gameName === undefined || name === gameName)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => { if (busy) dialog.current?.focus() }, [busy])

  return (
    <div className="editor-backdrop" role="alertdialog" aria-modal="true" aria-label={gameName === undefined ? '删除图片确认' : '删除游戏确认'} aria-describedby="delete-description" ref={dialog} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
        if (event.key === 'Tab') {
          if (busy) { event.preventDefault(); return }
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'))
          const first = controls[0], last = controls[controls.length - 1]
          if (document.activeElement === event.currentTarget) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <form className="editor-card management-dialog" onSubmit={(event) => { event.preventDefault(); if (canConfirm) onConfirm() }}>
        <h2>{gameName === undefined ? '删除图片' : '删除游戏'}</h2>
        <p id="delete-description">{gameName === undefined ? '即将永久删除' : `即将永久删除游戏「${gameName}」及其中的`} {count} 张图片，此操作无法撤销。</p>
        {gameName !== undefined && <label><span>输入完整游戏名称</span><input aria-label="输入完整游戏名称" autoComplete="off" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>}
        {error && <div className="editor-error" role="alert">{error}</div>}
        <div className="management-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="danger-button" type="submit" disabled={!canConfirm}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </form>
    </div>
  )
}
