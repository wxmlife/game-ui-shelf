import { describe, expect, it } from 'vitest'

import { buildFileFingerprint, buildImportDraft, MAX_UPLOAD_BYTES } from './buildImportDraft'

function folderFile(path: string, options: { size?: number; type?: string; modified?: number } = {}) {
  const fileName = path.split('/').at(-1) ?? path
  const file = new File(['x'], fileName, {
    type: options.type ?? 'image/png',
    lastModified: options.modified ?? 100,
  })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  if (options.size !== undefined) Object.defineProperty(file, 'size', { value: options.size })
  return file
}

describe('buildImportDraft', () => {
  it('groups a selected directory under its game and infers editable fields', () => {
    const draft = buildImportDraft([
      folderFile('IDOL/home首页.png'),
      folderFile('IDOL/reward奖励-奖励详情.png'),
    ])

    expect(draft.gameName).toBe('IDOL')
    expect(draft.files).toHaveLength(2)
    expect(draft.files[1]).toMatchObject({
      moduleKey: 'reward',
      moduleName: '奖励',
      flowName: '奖励',
      title: '奖励详情',
      tags: ['奖励', '详情'],
      status: 'ready',
    })
  })

  it('keeps stable source order unless filenames include numeric prefixes', () => {
    const draft = buildImportDraft([
      folderFile('IDOL/03-reward奖励-领取.png'),
      folderFile('IDOL/home首页.png'),
      folderFile('IDOL/01-reward奖励-入口.png'),
    ])

    expect(draft.files.map((file) => [file.originalFilename, file.sequenceOrder])).toEqual([
      ['03-reward奖励-领取.png', 3],
      ['home首页.png', 2],
      ['01-reward奖励-入口.png', 1],
    ])
  })

  it('populates editable draft fields from an underscore filename', () => {
    const draft = buildImportDraft([folderFile('IDOL/公会_兑换商店界面_2.jpg')])

    expect(draft.files[0]).toMatchObject({
      moduleKey: '公会',
      moduleName: '公会',
      flowName: '',
      title: '兑换商店界面',
      sequenceOrder: 2,
      tags: ['公会', '兑换', '商店'],
      status: 'ready',
    })
  })

  it('reports unsupported, duplicate, and over-limit files before upload', () => {
    const duplicate = folderFile('IDOL/task任务.png', { modified: 333 })
    const existing = new Set([buildFileFingerprint(duplicate)])
    const draft = buildImportDraft([
      folderFile('IDOL/readme.txt', { type: 'text/plain' }),
      duplicate,
      folderFile('IDOL/reward奖励.png', { size: MAX_UPLOAD_BYTES + 1 }),
    ], existing)

    expect(draft.readyFiles).toHaveLength(0)
    expect(draft.rejectedFiles.map((file) => file.issues[0]?.code)).toEqual([
      'unsupported-type',
      'duplicate',
      'large-file',
    ])
  })

  it('also catches duplicate files inside one selection', () => {
    const first = folderFile('IDOL/home首页.png', { modified: 999 })
    const second = folderFile('IDOL/home首页.png', { modified: 999 })
    const draft = buildImportDraft([first, second])

    expect(draft.readyFiles).toHaveLength(1)
    expect(draft.rejectedFiles).toHaveLength(1)
    expect(draft.rejectedFiles[0].issues[0]?.code).toBe('duplicate')
  })
})
