import { useEffect, useRef, useState } from 'react'

import type { UiImage } from '../domain/models'

export interface CoverFocus {
  x: number
  y: number
}

export interface GameCoverEditorProps {
  images: UiImage[]
  initialImage?: UiImage
  currentCoverUrl?: string
  initialFocus: CoverFocus
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSave: (selection: { image?: UiImage; focus: CoverFocus }) => void
}

const clampFocus = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

interface ImageBounds {
  left: number
  top: number
  width: number
  height: number
}

const fullImageBounds: ImageBounds = { left: 0, top: 0, width: 100, height: 100 }

function getContainedImageBounds(containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number) {
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  }
}

function getRenderedImageBounds(
  containerRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  imageRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  imageWidth: number,
  imageHeight: number,
) {
  const layoutRect = imageRect.width > 0 && imageRect.height > 0 ? imageRect : containerRect
  const containedBounds = getContainedImageBounds(layoutRect.width, layoutRect.height, imageWidth, imageHeight)
  return {
    left: layoutRect.left - containerRect.left + containedBounds.left,
    top: layoutRect.top - containerRect.top + containedBounds.top,
    width: containedBounds.width,
    height: containedBounds.height,
  }
}

export function GameCoverEditor({
  images,
  initialImage,
  currentCoverUrl,
  initialFocus,
  busy = false,
  error,
  onClose,
  onSave,
}: GameCoverEditorProps) {
  const [selectedImage, setSelectedImage] = useState<UiImage | undefined>(() => (
    initialImage ? images.find((image) => image.id === initialImage.id) : undefined
  ))
  const [focus, setFocus] = useState<CoverFocus>(() => ({
    x: initialImage ? 50 : clampFocus(initialFocus.x),
    y: initialImage ? 50 : clampFocus(initialFocus.y),
  }))
  const [renderedImageBounds, setRenderedImageBounds] = useState<ImageBounds>(fullImageBounds)
  const dialogRef = useRef<HTMLDivElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const firstCandidateRef = useRef<HTMLButtonElement>(null)
  const draggingRef = useRef(false)
  const previewUrl = selectedImage?.imageUrl ?? currentCoverUrl
  const objectPosition = `${focus.x}% ${focus.y}%`
  const markerPosition = {
    left: `${renderedImageBounds.left + (renderedImageBounds.width * focus.x) / 100}%`,
    top: `${renderedImageBounds.top + (renderedImageBounds.height * focus.y) / 100}%`,
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (busy) dialogRef.current?.focus()
    else if (previewUrl) saveButtonRef.current?.focus()
    else firstCandidateRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy])

  const updateFocusFromPointer = (element: HTMLElement, clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const image = element.querySelector('img')
    const imageWidth = image?.naturalWidth || selectedImage?.width || rect.width
    const imageHeight = image?.naturalHeight || selectedImage?.height || rect.height
    const imageBounds = getRenderedImageBounds(rect, image?.getBoundingClientRect() ?? rect, imageWidth, imageHeight)
    const nextRenderedBounds = {
      left: (imageBounds.left / rect.width) * 100,
      top: (imageBounds.top / rect.height) * 100,
      width: (imageBounds.width / rect.width) * 100,
      height: (imageBounds.height / rect.height) * 100,
    }
    setRenderedImageBounds((current) => (
      Object.keys(nextRenderedBounds).every((key) => Math.abs(current[key as keyof ImageBounds] - nextRenderedBounds[key as keyof ImageBounds]) < 0.01)
        ? current
        : nextRenderedBounds
    ))
    setFocus({
      x: clampFocus(((clientX - rect.left - imageBounds.left) / imageBounds.width) * 100),
      y: clampFocus(((clientY - rect.top - imageBounds.top) / imageBounds.height) * 100),
    })
  }

  return (
    <div
      className="editor-backdrop cover-editor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cover-editor-title"
      aria-label="调整游戏封面"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (!busy) onClose()
        }
        if (event.key === 'Tab') {
          if (busy) {
            event.preventDefault()
            return
          }
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':is(input, button):not(:disabled)'))
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (document.activeElement === event.currentTarget) {
            event.preventDefault()
            ;(event.shiftKey ? last : first)?.focus()
            return
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <form
        className="editor-card cover-editor"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && previewUrl) onSave({ image: selectedImage, focus })
        }}
      >
        <div className="cover-editor-heading">
          <div>
            <p className="eyebrow">GAME COVER</p>
            <h2 id="cover-editor-title">调整游戏封面</h2>
            <p>选择截图后设置画面焦点，横版与竖版封面会围绕焦点自动裁切。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭封面编辑" disabled={busy} onClick={onClose}>×</button>
        </div>

        <div className="cover-editor-workspace">
          <section className="cover-editor-focus-panel" aria-labelledby="cover-focus-title">
            <h3 id="cover-focus-title">设置封面焦点</h3>
            {previewUrl ? (
              <div
                className="cover-focus-control"
                aria-label="拖动设置封面焦点"
                aria-disabled={busy}
                onPointerDown={(event) => {
                  if (busy) return
                  draggingRef.current = true
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  updateFocusFromPointer(event.currentTarget, event.clientX, event.clientY)
                }}
                onPointerMove={(event) => {
                  if (!busy && draggingRef.current) updateFocusFromPointer(event.currentTarget, event.clientX, event.clientY)
                }}
                onPointerUp={(event) => {
                  draggingRef.current = false
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onPointerCancel={() => { draggingRef.current = false }}
              >
                <img
                  src={previewUrl}
                  alt="封面构图原图"
                  draggable="false"
                  onLoad={(event) => {
                    const control = event.currentTarget.parentElement
                    const rect = control?.getBoundingClientRect()
                    if (!rect || rect.width <= 0 || rect.height <= 0 || event.currentTarget.naturalWidth <= 0 || event.currentTarget.naturalHeight <= 0) return
                    const bounds = getRenderedImageBounds(
                      rect,
                      event.currentTarget.getBoundingClientRect(),
                      event.currentTarget.naturalWidth,
                      event.currentTarget.naturalHeight,
                    )
                    setRenderedImageBounds({
                      left: (bounds.left / rect.width) * 100,
                      top: (bounds.top / rect.height) * 100,
                      width: (bounds.width / rect.width) * 100,
                      height: (bounds.height / rect.height) * 100,
                    })
                  }}
                />
                <span
                  className="cover-focus-marker"
                  aria-hidden="true"
                  style={markerPosition}
                />
              </div>
            ) : (
              <div className="cover-editor-empty">请先选择一张游戏截图作为封面。</div>
            )}

            <div className="cover-focus-sliders">
              <label>
                <span>横向焦点</span>
                <input
                  type="range"
                  aria-label="横向焦点"
                  min="0"
                  max="100"
                  value={focus.x}
                  disabled={busy}
                  onChange={(event) => setFocus((current) => ({ ...current, x: clampFocus(Number(event.target.value)) }))}
                />
                <output>{focus.x}%</output>
              </label>
              <label>
                <span>纵向焦点</span>
                <input
                  type="range"
                  aria-label="纵向焦点"
                  min="0"
                  max="100"
                  value={focus.y}
                  disabled={busy}
                  onChange={(event) => setFocus((current) => ({ ...current, y: clampFocus(Number(event.target.value)) }))}
                />
                <output>{focus.y}%</output>
              </label>
            </div>
          </section>

          <section className="cover-editor-previews" aria-labelledby="cover-previews-title">
            <h3 id="cover-previews-title">封面预览</h3>
            <div className="cover-preview-grid">
              <figure className="cover-preview">
                <div className="cover-preview-image cover-preview-landscape">
                  {previewUrl ? <img src={previewUrl} alt="书架横版封面预览" style={{ objectPosition }} /> : <span>暂无封面</span>}
                </div>
                <figcaption>书架横版</figcaption>
              </figure>
              <figure className="cover-preview">
                <div className="cover-preview-image cover-preview-portrait">
                  {previewUrl ? <img src={previewUrl} alt="详情竖版封面预览" style={{ objectPosition }} /> : <span>暂无封面</span>}
                </div>
                <figcaption>详情竖版</figcaption>
              </figure>
            </div>
          </section>
        </div>

        <section className="cover-editor-candidates" aria-labelledby="cover-candidates-title">
          <div className="cover-editor-section-heading">
            <h3 id="cover-candidates-title">从游戏截图中选择</h3>
            <span>{images.length} 张</span>
          </div>
          {images.length > 0 ? (
            <div className="cover-candidate-grid">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  ref={index === 0 ? firstCandidateRef : undefined}
                  type="button"
                  className={`cover-candidate${selectedImage?.id === image.id ? ' is-selected' : ''}`}
                  aria-label={`选择截图：${image.title}`}
                  aria-pressed={selectedImage?.id === image.id}
                  disabled={busy}
                  onClick={() => {
                    setSelectedImage(image)
                    setFocus({ x: 50, y: 50 })
                    setRenderedImageBounds(fullImageBounds)
                  }}
                >
                  <img src={image.thumbnailUrl || image.imageUrl} alt="" />
                  <span>{image.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="cover-editor-empty">这个游戏还没有可用截图。</p>
          )}
        </section>

        {error && <div className="editor-error" role="alert">{error}</div>}

        <div className="management-dialog-actions cover-editor-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
          <button ref={saveButtonRef} type="submit" className="primary-button" disabled={busy || !previewUrl}>
            {busy ? '保存中…' : '保存封面'}
          </button>
        </div>
      </form>
    </div>
  )
}
