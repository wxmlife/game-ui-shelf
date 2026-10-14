import { GripVertical, Maximize2 } from 'lucide-react'

import type { UiImage } from '../domain/models'

interface ImageCardProps {
  image: UiImage
  onOpen: (image: UiImage) => void
  selected?: boolean
  busy?: boolean
  onSelect?: (imageId: string, selected: boolean) => void
  onMove?: (image: UiImage) => void
  onDragImage?: (imageId: string | null) => void
}

export function ImageCard({ image, onOpen, selected, busy, onSelect, onMove, onDragImage }: ImageCardProps) {
  return (
    <article className={`image-card${selected ? ' is-selected' : ''}`}>
      {(onSelect || onMove) && <div className="image-card-controls">
        {onSelect && <label><input type="checkbox" aria-label={`选择 ${image.title}`} checked={Boolean(selected)} disabled={busy} onChange={(event) => onSelect(image.id, event.target.checked)} /> 选择</label>}
        {onMove && <button type="button" className="image-move-handle" aria-label={`移动 ${image.title} 到模块`} disabled={busy} draggable={!busy}
          onClick={() => onMove(image)}
          onDragStart={(event) => { event.dataTransfer.setData('application/x-ui-image', image.id); event.dataTransfer.effectAllowed = 'move'; onDragImage?.(image.id) }}
          onDragEnd={() => onDragImage?.(null)}><GripVertical size={16} /> 移动</button>}
      </div>}
      <button type="button" className="image-card-preview" onClick={() => onOpen(image)} aria-label={`查看 ${image.title}`}>
        <img src={image.thumbnailUrl} alt="" loading="lazy" draggable={false} />
        <span className="image-card-zoom"><Maximize2 size={17} /> 查看大图</span>
        <span className="sequence-index">{String(image.sequenceOrder).padStart(2, '0')}</span>
      </button>
      <div className="image-card-body">
        <h4>{image.title}</h4>
        <div className="image-card-meta">
          <span>{image.platform}</span>
          <span>{image.version}</span>
        </div>
        <div className="tag-row">
          {image.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
        </div>
      </div>
    </article>
  )
}
