import { describe, expect, it } from 'vitest'

import { demoAsset, demoSnapshot } from './demoData'

describe('demo asset paths', () => {
  it('builds asset URLs from the configured site base', () => {
    expect(demoAsset('idol-cover', './')).toBe('./demo/idol-cover.svg')
    expect(demoAsset('idol-cover', '/game-ui-shelf/')).toBe('/game-ui-shelf/demo/idol-cover.svg')

    const urls = [
      ...demoSnapshot.games.map((game) => game.coverUrl),
      ...demoSnapshot.images.flatMap((image) => [image.imageUrl, image.thumbnailUrl]),
    ].filter((url): url is string => Boolean(url))

    expect(urls).not.toContain(undefined)
    expect(urls.every((url) => url.includes('demo/'))).toBe(true)
  })
})
