import { SlidersHorizontal, X } from 'lucide-react'

interface FilterBarProps {
  platforms: string[]
  tags: string[]
  platform: string
  tag: string
  onPlatformChange: (value: string) => void
  onTagChange: (value: string) => void
}

export function FilterBar({
  platforms,
  tags,
  platform,
  tag,
  onPlatformChange,
  onTagChange,
}: FilterBarProps) {
  const hasFilters = Boolean(platform || tag)

  return (
    <div className="filter-bar">
      <span className="filter-label"><SlidersHorizontal size={16} /> 筛选</span>
      <label>
        <span className="sr-only">平台</span>
        <select value={platform} onChange={(event) => onPlatformChange(event.target.value)}>
          <option value="">全部平台</option>
          {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label>
        <span className="sr-only">标签</span>
        <select value={tag} onChange={(event) => onTagChange(event.target.value)}>
          <option value="">全部标签</option>
          {tags.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      {hasFilters && (
        <button type="button" className="clear-filter" onClick={() => { onPlatformChange(''); onTagChange('') }}>
          <X size={14} /> 清除
        </button>
      )}
    </div>
  )
}
