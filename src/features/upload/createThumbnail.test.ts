import { afterEach, describe, expect, it, vi } from 'vitest'

import { calculateThumbnailSize, createThumbnail } from './createThumbnail'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('calculateThumbnailSize', () => {
  it('shrinks a landscape image so its longest edge is 560px', () => {
    expect(calculateThumbnailSize(1920, 1080)).toEqual({
      width: 560,
      height: 315,
    })
  })

  it('shrinks a portrait image while preserving its aspect ratio', () => {
    expect(calculateThumbnailSize(900, 1600)).toEqual({
      width: 315,
      height: 560,
    })
  })

  it('does not enlarge an image that is already within the limit', () => {
    expect(calculateThumbnailSize(320, 180)).toEqual({
      width: 320,
      height: 180,
    })
  })

  it('keeps very thin images at least one pixel wide', () => {
    expect(calculateThumbnailSize(1, 2000)).toEqual({
      width: 1,
      height: 560,
    })
  })

  it('accepts a custom maximum edge', () => {
    expect(calculateThumbnailSize(1200, 800, 300)).toEqual({
      width: 300,
      height: 200,
    })
  })

  it.each([
    [0, 100, 560],
    [-1, 100, 560],
    [100, Number.NaN, 560],
    [100, 100, 0],
    [100, 100, Number.POSITIVE_INFINITY],
  ])('rejects invalid dimensions (%s, %s) and limit %s', (width, height, maxEdge) => {
    expect(() => calculateThumbnailSize(width, height, maxEdge)).toThrow(RangeError)
  })
})

describe('createThumbnail', () => {
  it('revokes the object URL when image decoding fails', async () => {
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:broken-image'),
      revokeObjectURL,
    })

    class BrokenImage {
      decoding = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }

    vi.stubGlobal('Image', BrokenImage)

    const source = new File(['not really an image'], 'broken.png', { type: 'image/png' })

    await expect(createThumbnail(source)).rejects.toThrow('无法解码图片“broken.png”')
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken-image')
  })
})
