import { ArrowLeft, ArrowRight, Download, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { UiImage } from '../domain/models'

interface ImageViewerProps {
  images: UiImage[]
  initialImageId: string
  onClose: () => void
}

export function ImageViewer({ images, initialImageId, onClose }: ImageViewerProps) {
  const initialIndex = Math.max(0, images.findIndex((image) => image.id === initialImageId))
  const [index, setIndex] = useState(initialIndex)
  const image = images[index]
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
        <a className="secondary-button viewer-download" href={image.imageUrl} download={image.originalFilename}>
          <Download size={17} /> 下载原图
        </a>
      </aside>
    </div>
  )
}
