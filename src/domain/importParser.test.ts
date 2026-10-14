import { describe, expect, it } from 'vitest'

import { parseImportFile } from './importParser'

describe('parseImportFile', () => {
  it('parses a plain bilingual module filename', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/home首页.png',
      fileName: 'home首页.png',
      mimeType: 'image/png',
      sourceIndex: 4,
    })

    expect(result).toMatchObject({
      gameName: 'IDOL',
      moduleKey: 'home',
      moduleName: '首页',
      title: '首页',
      steps: [],
      sequenceOrder: 5,
      originalFilename: 'home首页.png',
      valid: true,
    })
  })

  it('uses hyphenated suffixes as action steps', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/reward奖励-奖励详情.png',
      fileName: 'reward奖励-奖励详情.png',
      mimeType: 'image/png',
      sourceIndex: 1,
    })

    expect(result.moduleKey).toBe('reward')
    expect(result.moduleName).toBe('奖励')
    expect(result.title).toBe('奖励详情')
    expect(result.steps).toEqual(['奖励详情'])
    expect(result.flowName).toBe('奖励')
    expect(result.sequenceOrder).toBe(2)
  })

  it('uses an optional numeric prefix as the explicit sequence order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/02-reward奖励-奖励领取.jpeg',
      fileName: '02-reward奖励-奖励领取.jpeg',
      mimeType: 'image/jpeg',
      sourceIndex: 9,
    })

    expect(result.moduleKey).toBe('reward')
    expect(result.title).toBe('奖励领取')
    expect(result.flowName).toBe('奖励')
    expect(result.sequenceOrder).toBe(2)
  })

  it('keeps underscores inside a legacy module key before parsing the hyphenated steps', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/guild_shop公会商店-兑换详情.png',
      fileName: 'guild_shop公会商店-兑换详情.png',
      mimeType: 'image/png',
      sourceIndex: 4,
    })

    expect(result).toMatchObject({
      moduleKey: 'guild_shop',
      moduleName: '公会商店',
      title: '兑换详情',
      flowName: '公会商店',
      steps: ['兑换详情'],
      sequenceOrder: 5,
    })
  })

  it('keeps a plain legacy ASCII module key that contains underscores', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/guild_shop公会商店.png',
      fileName: 'guild_shop公会商店.png',
      mimeType: 'image/png',
      sourceIndex: 0,
    })

    expect(result).toMatchObject({
      moduleKey: 'guild_shop',
      moduleName: '公会商店',
      title: '公会商店',
      flowName: '',
      steps: [],
      sequenceOrder: 1,
    })
  })

  it('parses an ASCII module followed by the recommended underscore title and order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/shop_兑换商店_2.jpg',
      fileName: 'shop_兑换商店_2.jpg',
      mimeType: 'image/jpeg',
      sourceIndex: 8,
    })

    expect(result).toMatchObject({
      moduleKey: 'shop',
      moduleName: 'shop',
      title: '兑换商店',
      flowName: '兑换商店',
      steps: ['兑换商店'],
      sequenceOrder: 2,
    })
  })

  it('keeps a prefixed legacy underscore key and uses the final step as the title', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/02_battle_pass奖励-奖励入口-奖励确认-奖励详情.png',
      fileName: '02_battle_pass奖励-奖励入口-奖励确认-奖励详情.png',
      mimeType: 'image/png',
      sourceIndex: 9,
    })

    expect(result).toMatchObject({
      moduleKey: 'battle_pass',
      moduleName: '奖励',
      title: '奖励详情',
      flowName: '奖励入口',
      steps: ['奖励入口', '奖励确认', '奖励详情'],
      sequenceOrder: 2,
    })
  })

  it('parses a Chinese module and title without an explicit order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/公会_总部已解锁.jpg',
      fileName: '公会_总部已解锁.jpg',
      mimeType: 'image/jpeg',
      sourceIndex: 0,
    })

    expect(result).toMatchObject({
      moduleKey: '公会',
      moduleName: '公会',
      title: '总部已解锁',
      flowName: '总部已解锁',
      sequenceOrder: 1,
      originalFilename: '公会_总部已解锁.jpg',
      valid: true,
    })
  })

  it('uses only a final numeric underscore segment as the explicit order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/公会_兑换商店界面_2.jpg',
      fileName: '公会_兑换商店界面_2.jpg',
      mimeType: 'image/jpeg',
      sourceIndex: 8,
    })

    expect(result).toMatchObject({
      moduleName: '公会',
      title: '兑换商店界面',
      flowName: '兑换商店界面',
      sequenceOrder: 2,
    })
  })

  it('keeps internal underscores in the title and only removes a final order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/公会_商店_兑换_3_预览.jpg',
      fileName: '公会_商店_兑换_3_预览.jpg',
      mimeType: 'image/jpeg',
      sourceIndex: 2,
    })

    expect(result.title).toBe('商店_兑换_3_预览')
    expect(result.flowName).toBe('商店_兑换_3_预览')
    expect(result.sequenceOrder).toBe(3)
  })

  it('keeps internal underscores when the final segment is an order', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/公会_商店_兑换_3.jpg',
      fileName: '公会_商店_兑换_3.jpg',
      mimeType: 'image/jpeg',
      sourceIndex: 8,
    })

    expect(result.title).toBe('商店_兑换')
    expect(result.flowName).toBe('商店_兑换')
    expect(result.sequenceOrder).toBe(3)
  })

  it('keeps the first folder as the game when files are nested', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/iOS-1.0/task任务-任务领取.webp',
      fileName: 'task任务-任务领取.webp',
      mimeType: 'image/webp',
      sourceIndex: 0,
    })

    expect(result.gameName).toBe('IDOL')
    expect(result.moduleKey).toBe('task')
    expect(result.title).toBe('任务领取')
  })

  it('rejects unsupported extensions with an actionable issue', () => {
    const result = parseImportFile({
      relativePath: 'IDOL/reward奖励.txt',
      fileName: 'reward奖励.txt',
      mimeType: 'text/plain',
      sourceIndex: 0,
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'unsupported-type',
      message: '仅支持 PNG、JPEG、WebP、GIF 和 AVIF 图片',
    })
  })

  it('preserves the original filename exactly', () => {
    const result = parseImportFile({
      relativePath: 'Reverse 1999/01-Reward奖励-领取 结果.PNG',
      fileName: '01-Reward奖励-领取 结果.PNG',
      mimeType: 'image/png',
      sourceIndex: 0,
    })

    expect(result.originalFilename).toBe('01-Reward奖励-领取 结果.PNG')
    expect(result.relativePath).toBe('Reverse 1999/01-Reward奖励-领取 结果.PNG')
  })
})
