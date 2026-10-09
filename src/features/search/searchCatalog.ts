import type {
  Game,
  LibrarySnapshot,
  SearchFilters,
  SearchResults,
  UiImage,
} from '../../domain/models'

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

function includesEveryTerm(haystack: string, terms: string[]): boolean {
  const normalizedHaystack = normalize(haystack)
  return terms.every((term) => normalizedHaystack.includes(term))
}

function gameText(game: Game): string {
  return [
    game.name,
    ...game.aliases,
    game.developer ?? '',
    ...game.platforms,
    ...game.tags,
  ].join(' ')
}

function imageText(image: UiImage, game?: Game): string {
  return [
    image.title,
    image.originalFilename,
    image.moduleKey,
    image.moduleName,
    image.flowName ?? '',
    image.platform ?? '',
    image.version ?? '',
    ...image.tags,
    image.searchText ?? '',
    game ? gameText(game) : '',
  ].join(' ')
}

function imageMatchesFilters(image: UiImage, filters: SearchFilters): boolean {
  if (filters.gameId && image.gameId !== filters.gameId) return false
  if (filters.moduleKey && normalize(image.moduleKey) !== normalize(filters.moduleKey)) {
    return false
  }
  if (filters.platform && normalize(image.platform ?? '') !== normalize(filters.platform)) {
    return false
  }
  if (filters.version && normalize(image.version ?? '') !== normalize(filters.version)) {
    return false
  }

  if (filters.tags?.length) {
    const imageTags = new Set(image.tags.map(normalize))
    if (!filters.tags.every((tag) => imageTags.has(normalize(tag)))) return false
  }

  return true
}

export function searchCatalog(
  snapshot: LibrarySnapshot,
  query: string,
  filters: SearchFilters = {},
): SearchResults {
  const terms = tokenize(query)
  const gamesById = new Map(snapshot.games.map((game) => [game.id, game]))
  const images = snapshot.images.filter((image) => {
    if (!imageMatchesFilters(image, filters)) return false
    return includesEveryTerm(imageText(image, gamesById.get(image.gameId)), terms)
  })

  const filteredGameIds = new Set(images.map((image) => image.gameId))
  const hasImageFilters = Boolean(
    filters.gameId ||
      filters.moduleKey ||
      filters.platform ||
      filters.version ||
      filters.tags?.length,
  )
  const games = snapshot.games.filter((game) => {
    if (filters.gameId && game.id !== filters.gameId) return false
    if (hasImageFilters && !filteredGameIds.has(game.id)) return false

    const relatedImageText = snapshot.images
      .filter((image) => image.gameId === game.id)
      .map((image) => imageText(image, game))
      .join(' ')

    return includesEveryTerm(`${gameText(game)} ${relatedImageText}`, terms)
  })

  return { games, images }
}
