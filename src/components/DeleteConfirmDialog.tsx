import { useEffect, useRef } from 'react'

type DeleteTarget =
  | { kind: 'images' }
  | { kind: 'game'; name: string }

interface DeleteConfirmDialogProps {
  count: number
  target: DeleteTarget
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmDialog({ count, target, busy, error, onClose, onConfirm }: DeleteConfirmDialogProps) {
  const dialog = useRef<HTMLDivElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const isGame = target.kind === 'game'
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (isGame) confirmButton.current?.focus()
    else dialog.current?.querySelector<HTMLElement>('button')?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => { if (busy) dialog.current?.focus() }, [busy])

  return (
    <div className="editor-backdrop" role="alertdialog" aria-modal="true" aria-label={isGame ? '删除游戏确认' : '删除图片确认'} aria-describedby="delete-description" ref={dialog} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
        if (event.key === 'Tab') {
          if (busy) { event.preventDefault(); return }
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'))
          const first = controls[0], last = controls[controls.length - 1]
          if (document.activeElement === event.currentTarget) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <form className="editor-card management-dialog" onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm() }}>
        <h2>{isGame ? '删除游戏' : '删除图片'}</h2>
        <p id="delete-description">{isGame ? `即将永久删除游戏「${target.name}」及其中的` : '即将永久删除'} {count} 张图片，此操作无法撤销。</p>
        {error && <div className="editor-error" role="alert">{error}</div>}
        <div className="management-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button>
          <button ref={confirmButton} className="danger-button" type="submit" disabled={busy}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </form>
    </div>
  )
}
