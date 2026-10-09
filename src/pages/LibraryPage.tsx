import { ArrowRight, LayoutGrid, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { EmptyState } from '../components/EmptyState'
import { FilterBar } from '../components/FilterBar'
import { GameCard } from '../components/GameCard'

export function LibraryPage() {
  const { snapshot, loading, error } = useLibrary()
  const [platform, setPlatform] = useState('')
  const [tag, setTag] = useState('')

  const platforms = useMemo(
    () => [...new Set(snapshot?.games.flatMap((game) => game.platforms) ?? [])].sort(),
    [snapshot],
  )
  const tags = useMemo(
    () => [...new Set(snapshot?.games.flatMap((game) => game.tags) ?? [])].sort(),
    [snapshot],
  )
  const games = useMemo(
    () =>
      snapshot?.games.filter(
        (game) =>
          (!platform || game.platforms.includes(platform)) &&
          (!tag || game.tags.includes(tag)),
      ) ?? [],
    [snapshot, platform, tag],
  )

  if (loading) return <div className="page-loading"><span />正在整理书架…</div>
  if (error) return <EmptyState title="资料库没有加载成功" description={error} />
  if (!snapshot) return null

  return (
    <main className="page library-page">
      <section className="library-hero">
        <div>
          <p className="eyebrow">PERSONAL GAME UI ARCHIVE</p>
          <h1>游戏书架</h1>
          <p className="hero-description">把散落的 UI 截图整理成随时可搜索、可比较的交互参考。</p>
        </div>
        <div className="hero-stats">
          <div><strong>{snapshot.games.length}</strong><span>本游戏</span></div>
          <div><strong>{snapshot.images.length}</strong><span>张截图</span></div>
          <div><strong>{new Set(snapshot.images.flatMap((item) => item.tags)).size}</strong><span>个标签</span></div>
        </div>
      </section>

      <section className="quick-start-card">
        <div className="quick-start-icon"><Upload size={22} /></div>
        <div>
          <strong>从一个游戏文件夹开始</strong>
          <p>选择文件夹，自动识别 home首页、task任务、reward奖励等模块。</p>
        </div>
        <Link to="/upload">打开上传工作台 <ArrowRight size={17} /></Link>
      </section>

      <div className="section-toolbar">
        <div className="section-title">
          <LayoutGrid size={19} />
          <span>{games.length} 本游戏</span>
        </div>
        <FilterBar
          platforms={platforms}
          tags={tags}
          platform={platform}
          tag={tag}
          onPlatformChange={setPlatform}
          onTagChange={setTag}
        />
      </div>

      {games.length ? (
        <section className="game-grid" aria-label="游戏列表">
          {games.map((game) => <GameCard key={game.id} game={game} />)}
        </section>
      ) : (
        <EmptyState compact title="没有符合条件的游戏" description="清除筛选条件后再看看。" />
      )}
    </main>
  )
}
