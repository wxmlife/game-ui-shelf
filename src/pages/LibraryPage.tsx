import { ArrowRight, LayoutGrid, Settings2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { FilterBar } from '../components/FilterBar'
import { GameCard } from '../components/GameCard'
import type { MutationResult } from '../data/libraryRepository'
import type { Game } from '../domain/models'

function mutationWarning(result: MutationResult) {
  return result.status === 'partial' ? result.message || `资料已更新，还有 ${result.pendingCleanup ?? 0} 个文件等待清理。下次加载时会重试。` : null
}

export function LibraryPage() {
  const [warning, setWarning] = useState<string | null>(null)
  const { snapshot, loading, error, repository, refresh } = useLibrary()
  const [platform, setPlatform] = useState('')
  const [tag, setTag] = useState('')
  const [managementMode, setManagementMode] = useState(false)
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoreManageFocus, setRestoreManageFocus] = useState(false)
  const busyRef = useRef(false)
  const active = useRef(true)
  const manageButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const canManageGames = repository.mode === 'cloud' && Boolean(repository.deleteGame)
  useEffect(() => {
    if (!restoreManageFocus || deletingGameId || busy) return
    manageButton.current?.focus()
    setRestoreManageFocus(false)
  }, [busy, deletingGameId, restoreManageFocus])

  const platforms = useMemo(
    () => [...new Set(snapshot?.games.flatMap((game) => game.platforms) ?? [])].sort(),
    [snapshot],
  )
  const tags = useMemo(
    () => [
      ...new Set([
        ...(snapshot?.games.flatMap((game) => game.tags) ?? []),
        ...(snapshot?.images.flatMap((image) => image.tags) ?? []),
      ]),
    ].sort(),
    [snapshot],
  )
  const games = useMemo(
    () => {
      if (!snapshot) return []

      return snapshot.games.filter(
        (game) =>
          (!platform || game.platforms.includes(platform)) &&
          (!tag ||
            game.tags.includes(tag) ||
            snapshot.images.some(
              (image) => image.gameId === game.id && image.tags.includes(tag),
            )),
      )
    },
    [snapshot, platform, tag],
  )
  const deletingGame = snapshot?.games.find((game) => game.id === deletingGameId)
  const deletingImageCount = deletingGame
    ? snapshot?.images.filter((image) => image.gameId === deletingGame.id).length ?? 0
    : 0

  function requestGameDeletion(game: Game) {
    if (!canManageGames || busyRef.current || !snapshot?.games.some((item) => item.id === game.id)) return
    setMutationError(null)
    setDeletingGameId(game.id)
  }

  async function confirmGameDeletion() {
    if (!deletingGame || !repository.deleteGame || busyRef.current) return
    const gameId = deletingGame.id
    busyRef.current = true
    setBusy(true)
    setMutationError(null)
    setWarning(null)
    try {
      const result = await repository.deleteGame(gameId)
      if (result.status === 'unavailable') throw new Error(result.message || '当前无法删除这个游戏')
      if (active.current) {
        setWarning(mutationWarning(result))
        setDeletingGameId(null)
        setRestoreManageFocus(true)
      }
      try {
        await refresh()
      } catch {
        // LibraryProvider keeps a route-independent, non-blocking refresh warning.
      }
    } catch (caught) {
      if (active.current) setMutationError(caught instanceof Error ? caught.message : '删除游戏失败，请重试')
    } finally {
      busyRef.current = false
      if (active.current) setBusy(false)
    }
  }

  if (loading) return <div className="page-loading"><span />正在整理书架…</div>
  if (error) return <EmptyState title="资料库没有加载成功" description={error} />
  if (!snapshot) return null

  return (
    <main className="page library-page">
      {warning && <div className="management-warning" role="status">{warning}</div>}
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
        <div className="section-toolbar-actions">
          {canManageGames && (
            <button ref={manageButton} className={`manage-games-button${managementMode ? ' is-active' : ''}`} type="button" disabled={busy}
              aria-pressed={managementMode} onClick={() => { setManagementMode((current) => !current); setMutationError(null) }}>
              <Settings2 size={15} /> {managementMode ? '完成管理' : '管理游戏'}
            </button>
          )}
          <FilterBar
            platforms={platforms}
            tags={tags}
            platform={platform}
            tag={tag}
            onPlatformChange={setPlatform}
            onTagChange={setTag}
          />
        </div>
      </div>

      {managementMode && <p className="game-management-note">管理模式：点击游戏卡片左上角的删除按钮；确认后将永久删除游戏及其中所有图片。</p>}

      {games.length ? (
        <section className="game-grid" aria-label="游戏列表">
          {games.map((game) => <GameCard key={game.id} game={game} managementMode={managementMode} busy={busy} onDelete={requestGameDeletion} />)}
        </section>
      ) : (
        <EmptyState compact title="没有符合条件的游戏" description="清除筛选条件后再看看。" />
      )}

      {deletingGame && <DeleteConfirmDialog count={deletingImageCount} target={{ kind: 'game', name: deletingGame.name }} busy={busy} error={mutationError}
        onClose={() => { if (!busy) { setDeletingGameId(null); setMutationError(null) } }} onConfirm={() => void confirmGameDeletion()} />}
    </main>
  )
}
