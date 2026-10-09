import { Search } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export function SearchBox() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(location.pathname === '/search' ? params.get('q') ?? '' : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (location.pathname === '/search') setQuery(params.get('q') ?? '')
  }, [location.pathname, params])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = query.trim()
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  return (
    <form className="global-search" role="search" onSubmit={handleSubmit}>
      <Search size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label="全库搜索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜游戏、模块、标题或标签…"
      />
      <kbd>⌘ K</kbd>
    </form>
  )
}
