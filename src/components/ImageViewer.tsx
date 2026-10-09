import { ArrowLeft, ArrowRight, Download, LoaderCircle, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { UiImage } from '../domain/models'
import type { ImageMetadataUpdate } from '../data/libraryRepository'

interface ImageViewerProps {
  images: UiImage[]
  initialImageId: string
  onClose: () => void
  onSaveMetadata?: (imageId: string, update: ImageMetadataUpdate) => Promise<void>
}

export function ImageViewer({ images, initialImageId, onClose, onSaveMetadata }: ImageViewerProps) {
  const initialIndex = Math.max(0, images.findIndex((image) => image.id === initialImageId))
  const [index, setIndex] = useState(initialIndex)
  const image = images[index]
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [flowName, setFlowName] = useState('')
  const [sequenceOrder, setSequenceOrder] = useState('0')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const canMove = images.length > 1
  const positionLabel = useMemo(() => `${index + 1} / ${images.length}`, [index, images.length])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && canMove) {
        setIndex((current) => (current - 1 + images.length) % images.length)
      }
      if (event.key === 'ArrowRight' && canMove) {
        setIndex((current) => (current + 1) % images.length)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [canMove, images.length, onClose])

  useEffect(() => {
    setEditing(false)
    setSaveError(null)
  }, [image?.id])

  function beginEditing() {
    if (!image) return
    setTitle(image.title)
    setFlowName(image.flowName ?? '')
    setSequenceOrder(String(image.sequenceOrder))
    setTags(image.tags.join(', '))
    setSaveError(null)
    setEditing(true)
  }

  async function saveMetadata() {
    if (!image || !onSaveMetadata || !title.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSaveMetadata(image.id, {
        moduleId: image.moduleId,
        title: title.trim(),
        flowName: flowName.trim(),
        sequenceOrder: Number(sequenceOrder) || 0,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      })
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '图片资料保存失败')
      setSaving(false)
    }
  }

  if (!image) return null

  return (
    <div className="viewer-backdrop" role="dialog" aria-modal="true" aria-label={image.title}>
      <button className="viewer-close" type="button" onClick={onClose} aria-label="关闭大图"><X /></button>
      <div className="viewer-canvas">
        {canMove && (
          <button
            type="button"
            className="viewer-nav viewer-nav--previous"
            onClick={() => setIndex((current) => (current - 1 + images.length) % images.length)}
            aria-label="上一张"
          ><ArrowLeft /></button>
        )}
        <img src={image.imageUrl} alt={image.title} />
        {canMove && (
          <button
            type="button"
            className="viewer-nav viewer-nav--next"
            onClick={() => setIndex((current) => (current + 1) % images.length)}
            aria-label="下一张"
          ><ArrowRight /></button>
        )}
      </div>
      <aside className="viewer-panel">
        {editing ? (
          <div className="viewer-editor">
            <p className="eyebrow">EDIT METADATA</p>
            <h2>编辑图片资料</h2>
            <label><span>图片标题</span><input aria-label="图片标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>流程名称</span><input aria-label="流程名称" value={flowName} onChange={(event) => setFlowName(event.target.value)} /></label>
            <label><span>图片标签</span><input aria-label="图片标签" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
            <label><span>序列顺序</span><input aria-label="序列顺序" type="number" value={sequenceOrder} onChange={(event) => setSequenceOrder(event.target.value)} /></label>
            {saveError && <div className="editor-error" role="alert">{saveError}</div>}
            <div className="viewer-editor-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(false)}>取消</button>
              <button className="primary-button" type="button" disabled={saving || !title.trim()} onClick={() => void saveMetadata()}>
                {saving && <LoaderCircle className="spin" size={15} />}
                {saving ? '保存中…' : '保存图片资料'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="eyebrow">{image.moduleName} · {positionLabel}</p>
            <h2>{image.title}</h2>
            {image.flowName && <p className="viewer-flow">动作流：{image.flowName}</p>}
            <dl>
              <div><dt>平台</dt><dd>{image.platform || '未记录'}</dd></div>
              <div><dt>版本</dt><dd>{image.version || '未记录'}</dd></div>
              <div><dt>尺寸</dt><dd>{image.width} × {image.height}</dd></div>
              <div><dt>文件名</dt><dd>{image.originalFilename}</dd></div>
            </dl>
            <div className="tag-row">
              {image.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
            </div>
            {onSaveMetadata && <button className="viewer-edit-button" type="button" onClick={beginEditing}><Pencil size={15} /> 编辑图片资料</button>}
          </>
        )}
        <a className="secondary-button viewer-download" href={image.imageUrl} download={image.originalFilename}>
          <Download size={17} /> 下载原图
        </a>
      </aside>
    </div>
  )
}
