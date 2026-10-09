import { Maximize2 } from 'lucide-react'

import type { UiImage } from '../domain/models'

interface ImageCardProps {
  image: UiImage
  onOpen: (image: UiImage) => void
}

export function ImageCard({ image, onOpen }: ImageCardProps) {
  return (
    <article className="image-card">
      <button type="button" className="image-card-preview" onClick={() => onOpen(image)} aria-label={`查看 ${image.title}`}>
        <img src={image.thumbnailUrl} alt="" loading="lazy" />
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
