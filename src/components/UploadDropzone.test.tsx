import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { UploadDropzone } from './UploadDropzone'

it('resets the native picker so the same folder can be selected again', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<UploadDropzone onSelect={onSelect} />)
  const chooser = screen.getByLabelText('选择游戏图片文件夹') as HTMLInputElement
  const file = new File(['image'], 'home首页.png', { type: 'image/png' })

  await user.upload(chooser, file)

  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(chooser.value).toBe('')

  await user.upload(chooser, file)
  expect(onSelect).toHaveBeenCalledTimes(2)
})
