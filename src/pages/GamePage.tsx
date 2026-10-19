import { ArrowLeft, CalendarDays, Gamepad2, Image as ImageIcon, ImagePlus, Pencil, Upload } from 'lucide-react'
import { type CSSProperties, type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { EmptyState } from '../components/EmptyState'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { type CoverFocus, GameCoverEditor } from '../components/GameCoverEditor'
import { ImageCard } from '../components/ImageCard'
import { ImageViewer } from '../components/ImageViewer'
import { ModuleEditor } from '../components/ModuleEditor'
import { MoveImageDialog } from '../components/MoveImageDialog'
import type { MutationResult } from '../data/libraryRepository'
import type { GameModule, UiImage } from '../domain/models'

const UI_IMAGE_DRAG_TYPE = 'application/x-ui-image'

function compareImages(a: UiImage, b: UiImage) {
  return a.sequenceOrder - b.sequenceOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function mutationWarning(result: MutationResult) {
  return result.status === 'partial' ? result.message || `资料已更新，还有 ${result.pendingCleanup ?? 0} 个文件等待清理。下次加载时会重试。` : null
}

export function GamePage() {
  const { gameId } = useParams()
  return <GameDetails key={gameId} gameId={gameId} />
}

function GameDetails({ gameId }: { gameId: string | undefined }) {
  const { snapshot, loading, error, repository, refresh } = useLibrary()
  const [selectedImage, setSelectedImage] = useState<UiImage | null>(null)
  const [editingModule, setEditingModule] = useState<GameModule | null>(null)
  const [movingImage, setMovingImage] = useState<UiImage | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deletion, setDeletion] = useState<{ gameId: string; ids: string[] } | null>(null)
  const [editingCover, setEditingCover] = useState<{ initialImage?: UiImage } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [cardDropTarget, setCardDropTarget] = useState<{ imageId: string; side: 'before' | 'after' } | null>(null)
  const editable = repository.mode === 'cloud'
  const canMove = editable && Boolean(repository.placeImage)
  const canDeleteImages = editable && Boolean(repository.deleteImages)
  const canManageCover = editable
    && Boolean(repository.setGameCoverFromImageWithFocus)
    && Boolean(repository.updateGameCoverFocus)

  const game = snapshot?.games.find((item) => item.id === gameId)
  const modules = useMemo(
    () => snapshot?.modules.filter((item) => item.gameId === gameId).sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [snapshot, gameId],
  )
  const gameImages = useMemo(
    () => snapshot?.images.filter((item) => item.gameId === gameId) ?? [],
    [snapshot, gameId],
  )

  async function mutate(action: () => Promise<MutationResult>, onSuccess: (result: MutationResult) => void, reportToEditor = false) {
    if (!active.current || busyRef.current) {
      if (reportToEditor) throw new Error('操作进行中，请稍后重试')
      return
    }
    busyRef.current = true
    setBusy(true)
    setMutationError(null)
    setWarning(null)
    try {
      const result = await action()
      if (result.status === 'unavailable') throw new Error(result.message || '当前无法执行此操作')
      try {
        await refresh()
      } catch {
        // LibraryProvider keeps a route-independent, non-blocking refresh warning.
      }
      if (active.current) {
        setWarning(mutationWarning(result))
        busyRef.current = false
        setBusy(false)
        onSuccess(result)
      }
    } catch (caught) {
      if (!active.current) return
      if (reportToEditor) throw caught
      setMutationError(caught instanceof Error ? caught.message : '操作失败，请重试')
    } finally {
      busyRef.current = false
      if (active.current) setBusy(false)
    }
  }

  async function placeImage(image: UiImage, targetModuleId: string, beforeImageId: string | null) {
    if (!canMove || !repository.placeImage || busyRef.current || image.gameId !== gameId || !modules.some((module) => module.id === targetModuleId)) return
    if (beforeImageId && !gameImages.some((item) => item.id === beforeImageId && item.moduleId === targetModuleId && item.id !== image.id)) return
    await mutate(() => repository.placeImage!(image.id, targetModuleId, beforeImageId), () => setMovingImage(null))
  }

  async function saveCover(image: UiImage | undefined, focus: CoverFocus) {
    if (!game || !canManageCover || !repository.setGameCoverFromImageWithFocus || !repository.updateGameCoverFocus || busyRef.current) return
    if (image && !gameImages.some((item) => item.id === image.id)) {
      setMutationError('这张图片已不在当前游戏中')
      return
    }

    await mutate(
      () => image
        ? repository.setGameCoverFromImageWithFocus!(game.id, image.id, focus.x, focus.y)
        : repository.updateGameCoverFocus!(game.id, focus.x, focus.y),
      () => setEditingCover(null),
    )
  }

  function handleModuleDragOver(event: DragEvent<HTMLElement>, moduleId: string) {
    const hasTransferImage = Array.from(event.dataTransfer.types ?? []).includes(UI_IMAGE_DRAG_TYPE)
    if (!canMove || busyRef.current || (!hasTransferImage && !draggingId)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setCardDropTarget(null)
    setDropTarget(moduleId)
  }

  function handleModuleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
  }

  function handleModuleDrop(event: DragEvent<HTMLElement>, moduleId: string) {
    event.preventDefault()
    event.stopPropagation()
    const transferId = event.dataTransfer.getData(UI_IMAGE_DRAG_TYPE)
    const image = gameImages.find((item) => item.id === (transferId || draggingId))
    setDropTarget(null)
    setCardDropTarget(null)
    setDraggingId(null)
    if (image && canMove && !busyRef.current) void placeImage(image, moduleId, null)
  }

  function cardPlacement(event: DragEvent<HTMLElement>, targetImage: UiImage, moduleImages: UiImage[]) {
    const rect = event.currentTarget.getBoundingClientRect()
    const side: 'before' | 'after' = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    const transferId = event.dataTransfer.getData(UI_IMAGE_DRAG_TYPE)
    const draggedId = transferId || draggingId
    const candidates = moduleImages.filter((item) => item.id !== draggedId)
    const targetIndex = candidates.findIndex((item) => item.id === targetImage.id)
    if (targetIndex < 0) return null
    return {
      side,
      beforeImageId: side === 'before' ? targetImage.id : candidates[targetIndex + 1]?.id ?? null,
    }
  }

  function handleCardDragOver(event: DragEvent<HTMLElement>, targetImage: UiImage, moduleImages: UiImage[]) {
    const hasTransferImage = Array.from(event.dataTransfer.types ?? []).includes(UI_IMAGE_DRAG_TYPE)
    if (!canMove || busyRef.current || (!hasTransferImage && !draggingId) || draggingId === targetImage.id) return
    const placement = cardPlacement(event, targetImage, moduleImages)
    if (!placement) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(null)
    setCardDropTarget({ imageId: targetImage.id, side: placement.side })
  }

  function handleCardDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCardDropTarget(null)
  }

  function handleCardDrop(event: DragEvent<HTMLElement>, targetImage: UiImage, moduleImages: UiImage[]) {
    event.preventDefault()
    event.stopPropagation()
    const transferId = event.dataTransfer.getData(UI_IMAGE_DRAG_TYPE)
    const image = gameImages.find((item) => item.id === (transferId || draggingId))
    const placement = cardPlacement(event, targetImage, moduleImages)
    setDropTarget(null)
    setCardDropTarget(null)
    setDraggingId(null)
    if (image && placement && canMove && !busyRef.current) void placeImage(image, targetImage.moduleId, placement.beforeImageId)
  }

  function requestDeletion(ids: string[]) {
    if (busyRef.current || !game || !ids.length || !ids.every((id) => gameImages.some((image) => image.id === id))) return
    setMutationError(null)
    setDeletion({ gameId: game.id, ids })
  }

  async function confirmDeletion() {
    if (!deletion || !game || deletion.gameId !== game.id || busyRef.current || !repository.deleteImages) return
    const ids = deletion.ids
    if (!ids.every((id) => gameImages.some((image) => image.id === id))) return
    await mutate(() => repository.deleteImages!(ids), () => {
      setDeletion(null)
      setSelectedImage(null)
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
    })
  }

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
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt={`${game.name}游戏封面`}
              style={{ objectPosition: `${game.coverFocusX}% ${game.coverFocusY}%` }}
            />
          ) : <span>{game.name.slice(0, 2)}</span>}
          {canManageCover && (
            <button
              type="button"
              className="game-cover-edit-button"
              aria-label={game.coverUrl ? '更换或调整游戏封面' : '设置游戏封面'}
              disabled={busy}
              onClick={() => {
                if (busyRef.current) return
                setMutationError(null)
                setEditingCover({})
              }}
            ><ImagePlus size={15} /> {game.coverUrl ? '更换或调整' : '设置封面'}</button>
          )}
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

      {(canDeleteImages || canMove) && <div className="game-management-bar">
        <p>这里用于模块与图片调整：勾选图片可跨模块批量删除；拖动移动手柄可调整模块和展示顺序，点击则可精确选择位置。</p>
      </div>}
      {warning && <div className="management-warning" role="status">{warning}</div>}
      {mutationError && !deletion && !movingImage && !editingCover && <div className="editor-error" role="alert">{mutationError}</div>}
      {selectedIds.length > 0 && <div className="selection-toolbar" role="toolbar" aria-label="图片批量管理">
        <strong>已选 {selectedIds.length} 张</strong>
        <button className="danger-button" type="button" disabled={busy} onClick={() => requestDeletion(selectedIds)}>删除已选</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setSelectedIds([])}>取消选择</button>
      </div>}

      <nav className="module-jump" aria-label="模块目录">
        <span>模块</span>
        {modules.map((module) => (
          <a
            className={dropTarget === module.id ? 'is-drop-target' : undefined}
            href={`#/game/${game.id}`}
            key={module.id}
            onClick={(event) => {
              event.preventDefault()
              document.getElementById(`module-${module.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            onDragOver={(event) => handleModuleDragOver(event, module.id)}
            onDragLeave={handleModuleDragLeave}
            onDrop={(event) => handleModuleDrop(event, module.id)}
          >{module.name}</a>
        ))}
      </nav>

      <div className="module-list">
        {modules.map((module) => {
          const moduleImages = gameImages
            .filter((image) => image.moduleId === module.id)
            .sort(compareImages)

          return (
            <section className={`module-section${dropTarget === module.id ? ' is-drop-target' : ''}`} id={`module-${module.id}`} key={module.id} aria-label={module.name}
              onDragOver={(event) => handleModuleDragOver(event, module.id)}
              onDragLeave={handleModuleDragLeave}
              onDrop={(event) => handleModuleDrop(event, module.id)}>
              <header className="module-heading">
                <div><span>{module.key}</span><h2>{module.name}</h2></div>
                <div className="module-heading-actions">
                  <p>{moduleImages.length} 张</p>
                  {editable && repository.updateModule && (
                    <button type="button" disabled={busy} aria-label={`编辑 ${module.name}模块`} onClick={() => { if (!busyRef.current) setEditingModule(module) }}><Pencil size={14} /> 编辑</button>
                  )}
                </div>
              </header>
              {moduleImages.length ? (
                <div className="image-grid">
                  {moduleImages.map((image) => <ImageCard key={image.id} image={image} onOpen={(item) => { if (!busyRef.current) setSelectedImage(item) }} busy={busy}
                    selected={selectedIds.includes(image.id)}
                    onSelect={canDeleteImages ? (id, selected) => setSelectedIds((current) => selected ? [...new Set([...current, id])] : current.filter((item) => item !== id)) : undefined}
                    onMove={canMove ? (item) => { if (busyRef.current) return; setMutationError(null); setMovingImage(item) } : undefined}
                    onDragImage={(id) => {
                      setDraggingId(id)
                      if (!id) { setDropTarget(null); setCardDropTarget(null) }
                    }}
                    dropSide={cardDropTarget?.imageId === image.id ? cardDropTarget.side : undefined}
                    onDragOverCard={canMove ? (event) => handleCardDragOver(event, image, moduleImages) : undefined}
                    onDragLeaveCard={canMove ? handleCardDragLeave : undefined}
                    onDropCard={canMove ? (event) => handleCardDrop(event, image, moduleImages) : undefined} />)}
                </div>
              ) : (
                <div className="module-empty">这个模块还没有截图</div>
              )}
            </section>
          )
        })}
      </div>

      {selectedImage && (
        <ImageViewer
          images={gameImages.filter((image) => image.moduleId === selectedImage.moduleId).sort(compareImages)}
          initialImageId={selectedImage.id}
          onClose={() => { if (!busyRef.current) setSelectedImage(null) }}
          suspended={Boolean(deletion) || busy}
          onDelete={canDeleteImages ? (image) => requestDeletion([image.id]) : undefined}
          onSetCover={canManageCover ? async (image) => {
            if (!gameImages.some((item) => item.id === image.id)) throw new Error('这张图片已不在当前游戏中')
            setSelectedImage(null)
            setMutationError(null)
            setEditingCover({ initialImage: image })
          } : undefined}
          onSaveMetadata={editable && repository.updateImageMetadata ? async (imageId, update) => {
            if (!gameImages.some((image) => image.id === imageId)) return
            await mutate(() => repository.updateImageMetadata!(imageId, update), () => setSelectedImage(null), true)
          } : undefined}
        />
      )}
      {editingModule && editable && repository.updateModule && (
        <ModuleEditor
          module={editingModule}
          onClose={() => { if (!busyRef.current) setEditingModule(null) }}
          onSave={async (update) => {
            await mutate(() => repository.updateModule!(editingModule.id, update), () => setEditingModule(null), true)
          }}
        />
      )}
      {movingImage && <MoveImageDialog image={movingImage} modules={modules} images={gameImages} busy={busy} error={mutationError}
        onClose={() => { if (!busy) { setMovingImage(null); setMutationError(null) } }}
        onMove={(target, beforeImageId) => void placeImage(movingImage, target, beforeImageId)} />}
      {editingCover && (
        <GameCoverEditor
          images={gameImages.slice().sort(compareImages)}
          initialImage={editingCover.initialImage}
          currentCoverUrl={game.coverUrl}
          initialFocus={{ x: game.coverFocusX, y: game.coverFocusY }}
          busy={busy}
          error={mutationError}
          onClose={() => {
            if (busy) return
            setEditingCover(null)
            setMutationError(null)
          }}
          onSave={({ image, focus }) => void saveCover(image, focus)}
        />
      )}
      {deletion && <DeleteConfirmDialog count={deletion.ids.length} target={{ kind: 'images' }} busy={busy} error={mutationError}
        onClose={() => { if (!busy) { setDeletion(null); setMutationError(null) } }} onConfirm={() => void confirmDeletion()} />}
    </main>
  )
}
