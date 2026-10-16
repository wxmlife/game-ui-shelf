import { AlertTriangle, CheckCircle2, FileImage, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { UploadDraft, UploadDraftFile } from '../features/upload/uploadTypes'

interface LocalPreviewProps {
  file: File
}

function LocalPreview({ file }: LocalPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!URL.createObjectURL) return
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
    ? <img src={url} alt="" />
    : <span className="import-preview-fallback"><FileImage size={22} /></span>
}

interface ImportPreviewProps {
  draft: UploadDraft
  disabled?: boolean
  onMetaChange: (patch: Partial<Pick<UploadDraft, 'gameName' | 'platform' | 'version'>>) => void
  onFileChange: (fileId: string, patch: Partial<UploadDraftFile>) => void
  onRemove: (fileId: string) => void
}

function TagEditor({ item, disabled, onChange }: { item: UploadDraftFile; disabled?: boolean; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState(item.tags.join(', '))

  return (
    <input
      aria-label={`标签 ${item.originalFilename}`}
      placeholder="弹窗, 奖励, 动效"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = event.target.value
        setValue(nextValue)
        onChange(nextValue.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))
      }}
    />
  )
}

export function ImportPreview({ draft, disabled = false, onMetaChange, onFileChange, onRemove }: ImportPreviewProps) {
  return (
    <section className="import-preview" aria-labelledby="import-preview-title">
      <header className="import-preview-heading">
        <div>
          <p className="eyebrow">CHECK BEFORE UPLOAD</p>
          <h2 id="import-preview-title">导入预览</h2>
          <p>系统已按文件名识别模块、图片标题与关键词标签；上传前都可以修改。</p>
        </div>
        <div className="import-counts">
          <span><CheckCircle2 size={14} /> {draft.readyFiles.length} 张可上传</span>
          {draft.rejectedFiles.length > 0 && <span className="import-counts-warning"><AlertTriangle size={14} /> {draft.rejectedFiles.length} 张需处理</span>}
        </div>
      </header>

      <div className="import-meta-grid">
        <label>
          <span>游戏名称</span>
          <input disabled={disabled} value={draft.gameName} onChange={(event) => onMetaChange({ gameName: event.target.value })} />
        </label>
        <label>
          <span>平台</span>
          <input disabled={disabled} placeholder="例如 iOS / PC" value={draft.platform} onChange={(event) => onMetaChange({ platform: event.target.value })} />
        </label>
        <label>
          <span>版本</span>
          <input disabled={disabled} placeholder="例如 1.8.0" value={draft.version} onChange={(event) => onMetaChange({ version: event.target.value })} />
        </label>
      </div>

      <div className="import-file-list">
        {draft.readyFiles.map((item) => (
          <article className="import-file-card" key={item.id}>
            <div className="import-file-thumb"><LocalPreview file={item.file} /></div>
            <div className="import-file-fields">
              <div className="import-original-name"><CheckCircle2 size={13} /> {item.originalFilename}</div>
              <div className="import-field-grid">
                <label>
                  <span>图片标题</span>
                  <input disabled={disabled} aria-label={`图片标题 ${item.originalFilename}`} value={item.title} onChange={(event) => onFileChange(item.id, { title: event.target.value })} />
                </label>
                <label>
                  <span>模块标识</span>
                  <input disabled={disabled} aria-label={`模块标识 ${item.originalFilename}`} value={item.moduleKey} onChange={(event) => onFileChange(item.id, { moduleKey: event.target.value })} />
                </label>
                <label>
                  <span>模块名称</span>
                  <input disabled={disabled} aria-label={`模块名称 ${item.originalFilename}`} value={item.moduleName} onChange={(event) => onFileChange(item.id, { moduleName: event.target.value })} />
                </label>
                <label>
                  <span>流程名称</span>
                  <input disabled={disabled} aria-label={`流程名称 ${item.originalFilename}`} placeholder="可选" value={item.flowName} onChange={(event) => onFileChange(item.id, { flowName: event.target.value })} />
                </label>
                <label className="import-tags-field">
                  <span>标签（逗号分隔）</span>
                  <TagEditor item={item} disabled={disabled} onChange={(tags) => onFileChange(item.id, { tags })} />
                </label>
                <label className="import-order-field">
                  <span>顺序</span>
                  <input disabled={disabled} aria-label={`顺序 ${item.originalFilename}`} type="number" min="0" value={item.sequenceOrder} onChange={(event) => onFileChange(item.id, { sequenceOrder: Number(event.target.value) })} />
                </label>
              </div>
            </div>
            <button className="icon-button" type="button" disabled={disabled} aria-label={`移除 ${item.originalFilename}`} onClick={() => onRemove(item.id)}><Trash2 size={16} /></button>
          </article>
        ))}
      </div>

      {draft.rejectedFiles.length > 0 && (
        <div className="rejected-files">
          <h3><AlertTriangle size={16} /> 暂不上传</h3>
          {draft.rejectedFiles.map((item) => (
            <div key={item.id}>
              <span>{item.originalFilename}</span>
              <strong>{item.issues.map((issue) => issue.message).join('；')}</strong>
              <button type="button" disabled={disabled} onClick={() => onRemove(item.id)}>移除</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
