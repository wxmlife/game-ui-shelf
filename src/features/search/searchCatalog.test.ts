import { describe, expect, it } from 'vitest'

import type { LibrarySnapshot } from '../../domain/models'
import { searchCatalog } from './searchCatalog'

const snapshot: LibrarySnapshot = {
  games: [
    {
      id: 'idol',
      slug: 'idol',
      name: 'IDOL Empire',
      aliases: ['偶像帝国'],
      coverTone: '#7267f0',
      coverFocusX: 50,
      coverFocusY: 50,
      platforms: ['iOS', 'Android'],
      tags: ['经营', '偶像'],
      imageCount: 2,
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'ember',
      slug: 'ember-archive',
      name: 'Ember Archive',
      aliases: ['余烬档案'],
      coverTone: '#ed6a5a',
      coverFocusX: 50,
      coverFocusY: 50,
      platforms: ['PC'],
      tags: ['RPG'],
      imageCount: 1,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  captureSets: [],
  modules: [
    { id: 'mod-reward', gameId: 'idol', key: 'reward', name: '奖励', sortOrder: 1 },
    { id: 'mod-store', gameId: 'ember', key: 'store', name: '商店', sortOrder: 1 },
  ],
  images: [
    {
      id: 'reward-detail',
      gameId: 'idol',
      moduleId: 'mod-reward',
      moduleKey: 'reward',
      moduleName: '奖励',
      flowName: '领取奖励',
      title: '奖励详情',
      originalFilename: 'reward奖励-奖励详情.png',
      imageUrl: '/reward-detail.png',
      thumbnailUrl: '/reward-detail-thumb.webp',
      width: 1170,
      height: 2532,
      sequenceOrder: 1,
      tags: ['弹窗', '奖励'],
      platform: 'iOS',
      version: '1.8.0',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'reward-claim',
      gameId: 'idol',
      moduleId: 'mod-reward',
      moduleKey: 'reward',
      moduleName: '奖励',
      flowName: '领取奖励',
      title: '奖励领取',
      originalFilename: 'reward奖励-奖励领取.png',
      imageUrl: '/reward-claim.png',
      thumbnailUrl: '/reward-claim-thumb.webp',
      width: 1170,
      height: 2532,
      sequenceOrder: 2,
      tags: ['反馈', '奖励'],
      platform: 'Android',
      version: '1.8.0',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'store-home',
      gameId: 'ember',
      moduleId: 'mod-store',
      moduleKey: 'store',
      moduleName: '商店',
      title: '商店首页',
      originalFilename: 'store商店.png',
      imageUrl: '/store.png',
      thumbnailUrl: '/store-thumb.webp',
      width: 1920,
      height: 1080,
      sequenceOrder: 1,
      tags: ['商店'],
      platform: 'PC',
      version: '2.0',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
}

describe('searchCatalog', () => {
  it('returns the full catalog for an empty query', () => {
    const result = searchCatalog(snapshot, '   ', {})

    expect(result.games).toHaveLength(2)
    expect(result.images).toHaveLength(3)
  })

  it('matches English names and Chinese module text case-insensitively', () => {
    expect(searchCatalog(snapshot, 'idol', {}).games.map((game) => game.id)).toEqual([
      'idol',
    ])
    expect(searchCatalog(snapshot, '奖励', {}).images.map((image) => image.id)).toEqual([
      'reward-detail',
      'reward-claim',
    ])
  })

  it('requires every query term to match the same result', () => {
    expect(searchCatalog(snapshot, 'IDOL 奖励领取', {}).images.map((image) => image.id)).toEqual([
      'reward-claim',
    ])
    expect(searchCatalog(snapshot, 'IDOL 商店', {}).images).toEqual([])
  })

  it('finds image tags and keeps the owning game in the results', () => {
    const result = searchCatalog(snapshot, '弹窗', {})

    expect(result.images.map((image) => image.id)).toEqual(['reward-detail'])
    expect(result.games.map((game) => game.id)).toEqual(['idol'])
  })

  it('applies tag and platform filters together', () => {
    const result = searchCatalog(snapshot, '', {
      tags: ['奖励'],
      platform: 'iOS',
    })

    expect(result.images.map((image) => image.id)).toEqual(['reward-detail'])
    expect(result.games.map((game) => game.id)).toEqual(['idol'])
  })

  it('returns no results for unmatched text', () => {
    const result = searchCatalog(snapshot, '不存在的界面', {})

    expect(result).toEqual({ games: [], images: [] })
  })
})
