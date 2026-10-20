import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { demoSnapshot } from '../data/demoData'
import { ImageCard } from './ImageCard'

const image = demoSnapshot.images[0]

describe('ImageCard', () => {
  it('does not show management controls by default', () => {
    render(<ImageCard image={image} onOpen={vi.fn()} />)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `移动 ${image.title} 到模块或位置` })).not.toBeInTheDocument()
  })

  it('shows management controls when a management callback is provided', () => {
    render(<ImageCard image={image} onOpen={vi.fn()} onSelect={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: `选择 ${image.title}` })).toBeInTheDocument()
  })

  it('sets the preview image dimensions from the image metadata', () => {
    render(<ImageCard image={image} onOpen={vi.fn()} />)

    const preview = screen.getByRole('button', { name: `查看 ${image.title}` }).querySelector('img')
    expect(preview).toHaveAttribute('width', String(image.width))
    expect(preview).toHaveAttribute('height', String(image.height))
    expect(preview).toHaveStyle({ objectFit: 'contain' })
  })
})
