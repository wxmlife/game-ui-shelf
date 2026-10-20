import { LoaderCircle } from 'lucide-react'
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
    <section className="module-editor-inline" role="region" aria-label={`编辑 ${module.name}模块`}>
      <div className="module-editor-copy">
        <p className="eyebrow">MODULE SETTINGS</p>
        <h3>修改「{module.name}」模块</h3>
        <p>只修改模块资料，不会影响图片的选择、移动和顺序。</p>
      </div>
      <form className="module-editor-form" aria-label="编辑模块" onSubmit={(event) => void submit(event)}>
        <label>
          <span>模块标识</span>
          <input aria-label="模块标识" value={key} disabled={saving} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label>
          <span>模块显示名称</span>
          <input aria-label="模块显示名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <div className="editor-error module-editor-error" role="alert">{error}</div>}
        <div className="module-editor-actions">
          <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>取消编辑</button>
          <button className="primary-button" type="submit" disabled={saving || !key.trim() || !name.trim()}>
            {saving && <LoaderCircle className="spin" size={16} />}
            {saving ? '保存中…' : '保存模块'}
          </button>
        </div>
      </form>
    </section>
  )
}
