import { ArrowLeft, CalendarDays, Gamepad2, Image as ImageIcon, Upload } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { EmptyState } from '../components/EmptyState'
import { ImageCard } from '../components/ImageCard'
import { ImageViewer } from '../components/ImageViewer'
import type { UiImage } from '../domain/models'

function groupByFlow(images: UiImage[]): Array<[string, UiImage[]]> {
  const groups = new Map<string, UiImage[]>()
  for (const image of images) {
    const key = image.flowName || '其他界面'
    groups.set(key, [...(groups.get(key) ?? []), image])
  }
  return [...groups.entries()]
}

export function GamePage() {
  const { gameId } = useParams()
  const { snapshot, loading, error } = useLibrary()
  const [selectedImage, setSelectedImage] = useState<UiImage | null>(null)

  const game = snapshot?.games.find((item) => item.id === gameId)
  const modules = useMemo(
    () => snapshot?.modules.filter((item) => item.gameId === gameId).sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [snapshot, gameId],
  )
  const gameImages = useMemo(
    () => snapshot?.images.filter((item) => item.gameId === gameId) ?? [],
    [snapshot, gameId],
  )

  if (loading) return <div className="page-loading"><span />正在翻开这本游戏…</div>
  if (error) return <EmptyState title="游戏资料加载失败" description={error} />
  if (!game) {
    return <EmptyState eyebrow="GAME NOT FOUND" title="没找到这个游戏" description="它可能已被移动或删除。" actionLabel="返回游戏书架" actionTo="/" />
  }

  return (
    <main className="page game-page">
      <Link className="back-link" to="/"><ArrowLeft size={16} /> 返回书架</Link>
      <header className="game-hero" style={{ '--cover-tone': game.coverTone } as CSSProperties}>
        <div className="game-hero-cover">
          {game.coverUrl ? <img src={game.coverUrl} alt="" /> : <span>{game.name.slice(0, 2)}</span>}
        </div>
        <div className="game-hero-copy">
          <p className="eyebrow">GAME UI COLLECTION</p>
          <h1>{game.name}</h1>
          <p className="game-alias">{game.aliases.join(' / ')}</p>
          <p className="hero-description">{game.description}</p>
          <div className="game-meta-row">
            <span><Gamepad2 size={16} /> {game.platforms.join(' · ')}</span>
            <span><ImageIcon size={16} /> {gameImages.length} 张截图</span>
            <span><CalendarDays size={16} /> 最近更新 {new Date(game.updatedAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <div className="tag-row">
            {game.tags.map((tag) => <span className="tag tag--large" key={tag}>#{tag}</span>)}
          </div>
        </div>
        <Link className="primary-button game-upload-button" to="/upload"><Upload size={17} /> 添加截图</Link>
      </header>

      <nav className="module-jump" aria-label="模块目录">
        <span>模块</span>
        {modules.map((module) => <a href={`#/game/${game.id}#module-${module.id}`} key={module.id}>{module.name}</a>)}
      </nav>

      <div className="module-list">
        {modules.map((module) => {
          const moduleImages = gameImages
            .filter((image) => image.moduleId === module.id)
            .sort((a, b) => a.sequenceOrder - b.sequenceOrder)

          return (
            <section className="module-section" id={`module-${module.id}`} key={module.id}>
              <header className="module-heading">
                <div><span>{module.key}</span><h2>{module.name}</h2></div>
                <p>{moduleImages.length} 张</p>
              </header>
              {moduleImages.length ? (
                groupByFlow(moduleImages).map(([flowName, images]) => (
                  <div className="flow-group" key={flowName}>
                    {flowName !== '其他界面' && (
                      <div className="flow-heading">
                        <h3>{flowName}</h3>
                        <span>{images.length} 步</span>
                      </div>
                    )}
                    <div className="image-grid">
                      {images.map((image) => <ImageCard key={image.id} image={image} onOpen={setSelectedImage} />)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="module-empty">这个模块还没有截图</div>
              )}
            </section>
          )
        })}
      </div>

      {selectedImage && (
        <ImageViewer
          images={gameImages
            .filter((image) => (image.flowName || image.moduleId) === (selectedImage.flowName || selectedImage.moduleId))
            .sort((a, b) => a.sequenceOrder - b.sequenceOrder)}
          initialImageId={selectedImage.id}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </main>
  )
}
