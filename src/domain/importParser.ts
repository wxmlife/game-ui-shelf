import type {
  ImportFileInput,
  ImportIssue,
  ParsedImportFile,
} from './models'

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'])
const EXPLICIT_ORDER = /^(\d+)[\s_-]+/
const MODULE_KEY = /^([A-Za-z][A-Za-z0-9_]*)/

function splitPath(path: string): string[] {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function stripExtension(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return { stem: fileName, extension: '' }
  }

  return {
    stem: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex + 1).toLowerCase(),
  }
}

function parseModule(segment: string): { key: string; name: string } {
  const keyMatch = segment.match(MODULE_KEY)
  const key = keyMatch?.[1].toLowerCase() ?? segment.toLowerCase()
  const name = keyMatch ? segment.slice(keyMatch[1].length).trim() : segment.trim()

  return {
    key,
    name: name || key,
  }
}

export function parseImportFile(input: ImportFileInput): ParsedImportFile {
  const pathParts = splitPath(input.relativePath)
  const originalFilename = input.fileName || pathParts.at(-1) || ''
  const { stem: originalStem, extension } = stripExtension(originalFilename)
  const gameName = pathParts.length > 1 ? pathParts[0] : ''
  const orderMatch = originalStem.match(EXPLICIT_ORDER)
  const cleanStem = orderMatch
    ? originalStem.slice(orderMatch[0].length).trim()
    : originalStem.trim()
  const firstUnderscore = cleanStem.indexOf('_')
  const firstHyphen = cleanStem.indexOf('-')
  const legacyModuleSegment = firstHyphen >= 0 ? cleanStem.slice(0, firstHyphen) : cleanStem
  const legacyKeyMatch = legacyModuleSegment.match(MODULE_KEY)
  const legacyKey = legacyKeyMatch?.[1] ?? ''
  const hasAttachedLegacyName = Boolean(
    legacyKey && !legacyKey.endsWith('_') && legacyModuleSegment.slice(legacyKey.length).trim(),
  )
  const usesLegacyUnderscoreKey = hasAttachedLegacyName
    && (firstHyphen >= 0 || legacyKey.includes('_'))
  const usesUnderscoreFormat = firstUnderscore >= 0
    && !usesLegacyUnderscoreKey
    && (firstHyphen < 0 || firstUnderscore < firstHyphen)
  let module: ReturnType<typeof parseModule>
  let steps: string[]
  let title: string
  let flowName: string
  let underscoreOrder: number | undefined

  if (usesUnderscoreFormat) {
    module = parseModule(cleanStem.slice(0, firstUnderscore))
    const titleParts = cleanStem.slice(firstUnderscore + 1).split('_')
    if (/^\d+$/.test(titleParts.at(-1) ?? '')) {
      underscoreOrder = Number.parseInt(titleParts.pop()!, 10)
    }
    title = titleParts.join('_').trim() || module.name
    flowName = ''
    steps = [title]
  } else {
    const segments = cleanStem
      .split('-')
      .map((part) => part.trim())
      .filter(Boolean)
    module = parseModule(segments[0] ?? '')
    steps = segments.slice(1)
    title = steps.at(-1) || module.name
    flowName = steps.length ? (steps.length > 1 ? steps[0] : module.name) : ''
  }
  const issues: ImportIssue[] = []

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    issues.push({
      code: 'unsupported-type',
      message: '仅支持 PNG、JPEG、WebP、GIF 和 AVIF 图片',
    })
  }

  if (!gameName) {
    issues.push({
      code: 'missing-game',
      message: '请选择包含游戏名称的文件夹',
    })
  }

  if (!module.key) {
    issues.push({
      code: 'missing-module',
      message: '文件名需要包含模块名称',
    })
  }

  return {
    gameName,
    moduleKey: module.key,
    moduleName: module.name,
    flowName,
    title,
    steps,
    sequenceOrder: orderMatch
      ? Number.parseInt(orderMatch[1], 10)
      : (underscoreOrder ?? ((input.sourceIndex ?? 0) + 1)),
    originalFilename,
    relativePath: input.relativePath,
    extension,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes ?? 0,
    valid: issues.length === 0,
    issues,
  }
}
