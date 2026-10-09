import { FolderUp, Images } from 'lucide-react'
import { type DragEvent, useState } from 'react'

interface UploadDropzoneProps {
  onSelect: (files: File[]) => void
}

export function UploadDropzone({ onSelect }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false)

  function acceptDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    onSelect(Array.from(event.dataTransfer.files))
  }

  return (
    <label
      className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={acceptDrop}
    >
      <input
        aria-label="选择游戏图片文件夹"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(event) => onSelect(Array.from(event.target.files ?? []))}
      />
      <span className="upload-dropzone-icon"><FolderUp size={27} /></span>
      <span className="upload-dropzone-copy">
        <strong>选择一个游戏文件夹</strong>
        <span>也可以把文件夹拖到这里</span>
      </span>
      <span className="upload-dropzone-hint"><Images size={15} /> PNG · JPG · WebP · GIF · AVIF</span>
    </label>
  )
}
