import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { demoSnapshot } from '../data/demoData'
import { ImageViewer } from './ImageViewer'

const images = demoSnapshot.images.slice(0, 2)

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
