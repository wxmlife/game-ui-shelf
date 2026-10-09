import { LoaderCircle, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import type { ModuleUpdate } from '../data/libraryRepository'
import type { GameModule } from '../domain/models'

interface ModuleEditorProps {
  module: GameModule
  onClose: () => void
  onSave: (update: ModuleUpdate) => Promise<void>
}

export function ModuleEditor({ module, onClose, onSave }: ModuleEditorProps) {
  const [key, setKey] = useState(module.key)
  const [name, setName] = useState(module.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!key.trim() || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ key: key.trim(), name: name.trim() })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模块保存失败')
      setSaving(false)
    }
  }

  return (
    <div className="editor-backdrop" role="dialog" aria-modal="true" aria-label={`编辑 ${module.name}模块`}>
      <form className="editor-card" onSubmit={(event) => void submit(event)}>
        <button className="editor-close" type="button" aria-label="关闭模块编辑" onClick={onClose}><X size={18} /></button>
        <p className="eyebrow">EDIT MODULE</p>
        <h2>编辑模块</h2>
        <p>修改后，模块下已有图片会继续保留。</p>
        <label>
          <span>模块标识</span>
          <input aria-label="模块标识" value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label>
          <span>模块显示名称</span>
          <input aria-label="模块显示名称" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <div className="editor-error" role="alert">{error}</div>}
        <button className="primary-button" type="submit" disabled={saving || !key.trim() || !name.trim()}>
          {saving && <LoaderCircle className="spin" size={16} />}
          {saving ? '保存中…' : '保存模块'}
        </button>
      </form>
    </div>
  )
}
