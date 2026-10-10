const UI_KEYWORDS = [
  '兑换', '商店', '任务', '奖励', '签到', '背包', '角色', '详情',
  '总部', '解锁', '公会', '活动', '商城', '设置', '聊天', '好友',
  '邮件', '排行', '战斗', '关卡', '成就', '图鉴', '地图',
] as const

const GENERIC_WORDS = new Set(['界面', '页面', '图片', '截图', 'ui'])
const MAX_TAGS = 6

export function deriveAutoTags(moduleName: string, title: string): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const tag = raw.trim()
    const key = tag.toLocaleLowerCase()
    if (!tag || GENERIC_WORDS.has(key) || seen.has(key) || tags.length >= MAX_TAGS) return
    tags.push(tag)
    seen.add(key)
  }

  add(moduleName)

  const keywordMatches = UI_KEYWORDS.flatMap((word) => {
    const matches: { index: number; word: string }[] = []
    let index = title.indexOf(word)
    while (index >= 0) {
      matches.push({ index, word })
      index = title.indexOf(word, index + word.length)
    }
    return matches
  }).sort((a, b) => a.index - b.index || b.word.length - a.word.length)

  for (const match of keywordMatches) add(match.word)

  if (typeof Intl.Segmenter !== 'function') return tags

  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  for (const segment of segmenter.segment(title.replaceAll('_', ' '))) {
    const word = segment.segment.trim()
    if (!segment.isWordLike || word.length < 2 || UI_KEYWORDS.some((keyword) => word.includes(keyword))) continue
    add(word)
  }

  return tags
}
