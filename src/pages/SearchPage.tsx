import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { EmptyState } from '../components/EmptyState'
import { GameCard } from '../components/GameCard'
import { ImageCard } from '../components/ImageCard'
import { ImageViewer } from '../components/ImageViewer'
import type { UiImage } from '../domain/models'
import { searchCatalog } from '../features/search/searchCatalog'

export function SearchPage() {
  const { snapshot, loading, error } = useLibrary()
  const [params] = useSearchParams()
  const [selectedImage, setSelectedImage] = useState<UiImage | null>(null)
  const query = params.get('q')?.trim() ?? ''
  const results = useMemo(
    () => snapshot ? searchCatalog(snapshot, query, {}) : { games: [], images: [] },
    [snapshot, query],
  )

  if (loading) return <div className="page-loading"><span />正在搜索…</div>
  if (error) return <EmptyState title="搜索暂时不可用" description={error} />

  return (
    <main className="page search-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">GLOBAL SEARCH</p>
          <h1>搜索结果</h1>
          <p className="hero-description">
            {query ? <>关键词 <strong>“{query}”</strong></> : '输入关键词，搜索整个资料库。'}
          </p>
        </div>
        {query && <Link className="secondary-button" to="/search"><X size={16} /> 清空搜索</Link>}
      </header>

      {!query ? (
        <EmptyState compact eyebrow="START SEARCHING" title="想找什么界面？" description="可以搜索游戏名、模块、图片标题或任意标签。" />
      ) : results.games.length || results.images.length ? (
        <>
          {results.games.length > 0 && (
            <section className="result-section">
              <div className="result-heading"><h2>游戏</h2><span>{results.games.length}</span></div>
              <div className="game-grid game-grid--search">
                {results.games.map((game) => <GameCard key={game.id} game={game} />)}
              </div>
            </section>
          )}
          <section className="result-section">
            <div className="result-heading"><h2>截图</h2><span>找到 {results.images.length} 张截图</span></div>
            {results.images.length ? (
              <div className="image-grid image-grid--search">
                {results.images.map((image) => <ImageCard key={image.id} image={image} onOpen={setSelectedImage} />)}
              </div>
            ) : <p className="muted-copy">没有直接匹配的截图。</p>}
          </section>
        </>
      ) : (
        <EmptyState compact eyebrow="NO RESULTS" title="没有找到匹配内容" description="换一个游戏名、模块名或更短的关键词试试。" />
      )}

      {selectedImage && (
        <ImageViewer images={results.images} initialImageId={selectedImage.id} onClose={() => setSelectedImage(null)} />
      )}
    </main>
  )
}
