import { describe, expect, it } from 'vitest'

import type { LibrarySnapshot } from '../../domain/models'
import { createLibraryExport } from './exportLibrary'

const snapshot: LibrarySnapshot = {
  games: [
    {
      id: 'z-game',
      slug: 'z-game',
      name: 'Zeta',
      aliases: ['Z', 'A'],
      coverUrl: 'https://storage.example/z-cover.png?token=cover-secret',
      coverTone: '#222222',
      platforms: ['PC', 'Android'],
      tags: ['RPG', '动作'],
      imageCount: 1,
      updatedAt: '2026-10-08T00:00:00.000Z',
    },
    {
      id: 'a-game',
      slug: 'a-game',
      name: 'Alpha',
      aliases: [],
      coverTone: '#111111',
      platforms: ['iOS'],
      tags: [],
      imageCount: 1,
      updatedAt: '2026-10-09T00:00:00.000Z',
    },
  ],
  captureSets: [
    { id: 'z-capture', gameId: 'z-game', platform: 'PC', version: '2.0' },
    { id: 'a-capture', gameId: 'a-game', platform: 'iOS', version: '1.0' },
  ],
  modules: [
    { id: 'z-module', gameId: 'z-game', key: 'reward', name: '奖励', sortOrder: 2 },
    { id: 'a-module', gameId: 'a-game', key: 'home', name: '首页', sortOrder: 1 },
  ],
  images: [
    {
      id: 'z-image',
      gameId: 'z-game',
      captureSetId: 'z-capture',
      moduleId: 'z-module',
      moduleKey: 'reward',
      moduleName: '奖励',
      title: '奖励领取',
      originalFilename: 'reward奖励-奖励领取.png',
      imageUrl: 'https://storage.example/original.png?token=original-secret',
      thumbnailUrl: 'https://storage.example/thumb.webp?token=thumb-secret',
      width: 1170,
      height: 2532,
      sequenceOrder: 2,
      tags: ['反馈', '奖励'],
      createdAt: '2026-10-08T00:00:00.000Z',
      searchText: 'temporary derived text',
    },
    {
      id: 'a-image',
      gameId: 'a-game',
      captureSetId: 'a-capture',
      moduleId: 'a-module',
      moduleKey: 'home',
      moduleName: '首页',
      title: '首页默认态',
      originalFilename: 'home首页.png',
      imageUrl: 'blob:short-lived-original',
      thumbnailUrl: 'blob:short-lived-thumb',
      width: 1170,
      height: 2532,
      sequenceOrder: 1,
      tags: [],
      createdAt: '2026-10-09T00:00:00.000Z',
    },
  ],
}

describe('createLibraryExport', () => {
  it('生成固定时间、版本化且排序稳定的 JSON', () => {
    const exported = createLibraryExport(snapshot, '2026-10-09T12:00:00.000Z')
    const parsed = JSON.parse(exported)

    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-10-09T12:00:00.000Z')
    expect(parsed.data.games.map((game: { id: string }) => game.id)).toEqual(['a-game', 'z-game'])
    expect(parsed.data.captureSets.map((set: { id: string }) => set.id)).toEqual([
      'a-capture',
      'z-capture',
    ])
    expect(parsed.data.modules.map((module: { id: string }) => module.id)).toEqual([
      'a-module',
      'z-module',
    ])
    expect(parsed.data.images.map((image: { id: string }) => image.id)).toEqual([
      'a-image',
      'z-image',
    ])
    expect(parsed.data.games[1].aliases).toEqual(['A', 'Z'])
    expect(parsed.data.games[1].platforms).toEqual(['Android', 'PC'])
    expect(parsed.data.images[1].tags).toEqual(['反馈', '奖励'])
    expect(createLibraryExport(snapshot, '2026-10-09T12:00:00.000Z')).toBe(exported)
  })

  it('置空所有可过期图片 URL，但保留可恢复的文件元数据', () => {
    const exported = createLibraryExport(snapshot, '2026-10-09T12:00:00.000Z')
    const parsed = JSON.parse(exported)

    expect(parsed.data.games[1].coverUrl).toBeNull()
    expect(parsed.data.images[1]).toMatchObject({
      imageUrl: null,
      thumbnailUrl: null,
      originalFilename: 'reward奖励-奖励领取.png',
      width: 1170,
      height: 2532,
      sequenceOrder: 2,
    })
    expect(exported).not.toContain('cover-secret')
    expect(exported).not.toContain('original-secret')
    expect(exported).not.toContain('thumb-secret')
    expect(exported).not.toContain('blob:short-lived')
  })

  it('不修改传入的快照及其嵌套数组', () => {
    const before = structuredClone(snapshot)

    createLibraryExport(snapshot, '2026-10-09T12:00:00.000Z')

    expect(snapshot).toEqual(before)
  })
})
