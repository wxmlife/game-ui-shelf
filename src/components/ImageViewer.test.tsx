import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { demoSnapshot } from '../data/demoData'
import type { UiImage } from '../domain/models'
import { ImageViewer } from './ImageViewer'

const images = demoSnapshot.images.slice(0, 2)

describe('ImageViewer', () => {
  it('uses the filename-preserving URL for original downloads', () => {
    const image: UiImage = {
      id: 'image-1',
      gameId: 'game-1',
      moduleId: 'module-1',
      moduleKey: '公会',
      moduleName: '公会',
      title: '总榜已解锁',
      originalFilename: '公会_总榜已解锁.jpeg',
      imageUrl: 'https://storage.example/original.jpeg?token=preview',
      downloadUrl: 'https://storage.example/original.jpeg?token=download&download=chinese-name',
      thumbnailUrl: 'https://storage.example/thumb.webp',
      width: 1170,
      height: 2532,
      sequenceOrder: 1,
      tags: ['公会'],
      createdAt: '2026-10-10T00:00:00Z',
    }

    render(<ImageViewer images={[image]} initialImageId={image.id} onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: '下载原图' })).toHaveAttribute('href', image.downloadUrl)
  })
})

describe('ImageViewer keyboard behavior', () => {
  it('does not navigate while editing and lets Escape cancel editing before closing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ImageViewer
        images={images}
        initialImageId={images[0].id}
        onClose={onClose}
        onSaveMetadata={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '编辑图片资料' }))
    const titleInput = screen.getByLabelText('图片标题')
    await user.clear(titleInput)
    await user.type(titleInput, '尚未保存的标题')

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(screen.getByLabelText('图片标题')).toHaveValue('尚未保存的标题')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByLabelText('图片标题')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: images[0].title })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([
    ['input', <input aria-label="outside input" key="input" />],
    ['textarea', <textarea aria-label="outside textarea" key="textarea" />],
    ['select', <select aria-label="outside select" key="select"><option>One</option></select>],
    ['contenteditable', <div aria-label="outside contenteditable" contentEditable key="contenteditable" />],
  ])('does not navigate when an arrow key originates from %s', (_name, control) => {
    render(
      <>
        {control}
        <ImageViewer images={images} initialImageId={images[0].id} onClose={vi.fn()} />
      </>,
    )

    fireEvent.keyDown(screen.getByLabelText(`outside ${_name}`), { key: 'ArrowRight' })

    expect(screen.getByRole('heading', { name: images[0].title })).toBeInTheDocument()
  })

  it('still navigates with arrow keys outside editable controls', () => {
    render(<ImageViewer images={images} initialImageId={images[0].id} onClose={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(screen.getByRole('heading', { name: images[1].title })).toBeInTheDocument()
  })
})
