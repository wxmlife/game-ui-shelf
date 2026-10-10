import { describe, expect, it } from 'vitest'

import { deriveAutoTags } from './deriveAutoTags'

describe('deriveAutoTags', () => {
  it('keeps the module first and extracts UI concepts from a compound title', () => {
    expect(deriveAutoTags('公会', '兑换商店界面')).toEqual(['公会', '兑换', '商店'])
  })

  it('deduplicates concepts and excludes generic image words', () => {
    const tags = deriveAutoTags('公会', '公会_UI界面_页面_图片_截图')

    expect(tags).toEqual(['公会'])
  })

  it('caps deterministic tags at six', () => {
    expect(deriveAutoTags('公会', '兑换_商店_任务_奖励_签到_背包_角色')).toEqual([
      '公会', '兑换', '商店', '任务', '奖励', '签到',
    ])
  })

  it('keeps dictionary tags when Intl.Segmenter is unavailable', () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined })

    try {
      expect(deriveAutoTags('公会', '兑换商店界面_神秘机制')).toEqual(['公会', '兑换', '商店'])
    } finally {
      if (segmenterDescriptor) {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
      } else {
        Reflect.deleteProperty(Intl, 'Segmenter')
      }
    }
  })
})
