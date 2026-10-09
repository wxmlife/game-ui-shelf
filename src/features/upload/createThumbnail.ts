export const DEFAULT_THUMBNAIL_MAX_EDGE = 560

const DEFAULT_WEBP_QUALITY = 0.82
const IMAGE_DECODE_TIMEOUT_MS = 10_000

export interface ThumbnailSize {
  width: number
  height: number
}

export interface ThumbnailBlob extends Blob {
  readonly sourceWidth: number
  readonly sourceHeight: number
}

/**
 * Calculates integer canvas dimensions without ever enlarging the source.
 */
export function calculateThumbnailSize(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = DEFAULT_THUMBNAIL_MAX_EDGE,
): ThumbnailSize {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(maxEdge) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    maxEdge <= 0
  ) {
    throw new RangeError('图片尺寸和缩略图最长边必须是大于 0 的有限数值')
  }

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * Decodes an image in the browser and produces an upload-ready thumbnail.
 * WebP is requested first; browsers without WebP canvas encoding may return
 * PNG, whose MIME type remains available on the returned Blob.
 */
export async function createThumbnail(
  source: File,
  maxEdge = DEFAULT_THUMBNAIL_MAX_EDGE,
): Promise<ThumbnailBlob> {
  if (!source.type.startsWith('image/')) {
    throw new TypeError(`文件“${source.name}”不是可解码的图片`)
  }

  if (!Number.isFinite(maxEdge) || maxEdge <= 0) {
    throw new RangeError('缩略图最长边必须是大于 0 的有限数值')
  }

  const objectUrl = URL.createObjectURL(source)

  try {
    const image = await decodeImage(objectUrl, source.name)
    const size = calculateThumbnailSize(image.naturalWidth, image.naturalHeight, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前浏览器无法创建缩略图画布')
    }

    context.drawImage(image, 0, 0, size.width, size.height)

    const blob =
      (await encodeCanvas(canvas, 'image/webp', DEFAULT_WEBP_QUALITY)) ??
      (await encodeCanvas(canvas, 'image/png'))

    if (!blob) {
      throw new Error(`无法为“${source.name}”生成缩略图`)
    }

    Object.defineProperties(blob, {
      sourceWidth: { value: image.naturalWidth, enumerable: true },
      sourceHeight: { value: image.naturalHeight, enumerable: true },
    })

    return blob as ThumbnailBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function decodeImage(objectUrl: string, sourceName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'

    const timeout = window.setTimeout(() => {
      image.onload = null
      image.onerror = null
      reject(new Error(`图片“${sourceName}”解码超时`))
    }, IMAGE_DECODE_TIMEOUT_MS)

    image.onload = () => {
      window.clearTimeout(timeout)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error(`无法解码图片“${sourceName}”`))
    }
    image.src = objectUrl
  })
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/png',
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality)
  })
}
