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
      sequenceOrder: 4,
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
    expect(result.sequenceOrder).toBe(1)
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
    expect(result.sequenceOrder).toBe(2)
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
