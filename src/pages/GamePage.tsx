import { ArrowLeft, CalendarDays, Gamepad2, Image as ImageIcon, Pencil, Upload } from 'lucide-react'
import { type CSSProperties, type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useLibrary } from '../app/LibraryContext'
import { EmptyState } from '../components/EmptyState'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
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

interface DisplayGroup {
  key: string
  flowName?: string
  images: UiImage[]
}

function groupForDisplay(images: UiImage[]): DisplayGroup[] {
  const sorted = [...images].sort(compareImages)
  const flowCounts = new Map<string, number>()
  for (const image of sorted) {
    if (image.flowId) flowCounts.set(image.flowId, (flowCounts.get(image.flowId) ?? 0) + 1)
  }

  const groups = new Map<string, DisplayGroup>()
  for (const image of sorted) {
    const isSequence = Boolean(image.flowId && (flowCounts.get(image.flowId) ?? 0) > 1)
    const key = isSequence ? `flow:${image.flowId}` : 'module-grid'
    const group = groups.get(key) ?? {
      key,
      flowName: isSequence ? image.flowName : undefined,
      images: [],
    }
    group.images.push(image)
    groups.set(key, group)
  }
  return [...groups.values()]
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
  const editable = repository.mode === 'cloud'
  const canMove = editable && Boolean(repository.moveImage)
  const canDeleteImages = editable && Boolean(repository.deleteImages)
  const canSetCover = editable && Boolean(repository.setGameCoverFromImage)

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
      if (active.current) {
        setWarning(mutationWarning(result))
        onSuccess(result)
      }
      try {
        await refresh()
      } catch {
        // LibraryProvider keeps a route-independent, non-blocking refresh warning.
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

  async function moveImage(image: UiImage, targetModuleId: string) {
    if (!canMove || !repository.moveImage || busyRef.current || image.gameId !== gameId || !modules.some((module) => module.id === targetModuleId)) return
    if (image.moduleId === targetModuleId) { setMovingImage(null); return }
    await mutate(() => repository.moveImage!(image.id, targetModuleId), () => setMovingImage(null))
  }

  function handleModuleDragOver(event: DragEvent<HTMLElement>, moduleId: string) {
    const hasTransferImage = Array.from(event.dataTransfer.types ?? []).includes(UI_IMAGE_DRAG_TYPE)
    if (!canMove || busyRef.current || (!hasTransferImage && !draggingId)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(moduleId)
  }

  function handleModuleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
  }

  function handleModuleDrop(event: DragEvent<HTMLElement>, moduleId: string) {
    event.preventDefault()
    const transferId = event.dataTransfer.getData(UI_IMAGE_DRAG_TYPE)
    const image = gameImages.find((item) => item.id === (transferId || draggingId))
    setDropTarget(null)
    setDraggingId(null)
    if (image && canMove && !busyRef.current) void moveImage(image, moduleId)
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

      {(canDeleteImages || canMove) && <div className="game-management-bar">
        <p>这里用于模块与图片调整：勾选图片可跨模块批量删除；点击移动手柄可调整所属模块。</p>
      </div>}
      {warning && <div className="management-warning" role="status">{warning}</div>}
      {mutationError && !deletion && !movingImage && <div className="editor-error" role="alert">{mutationError}</div>}
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
                groupForDisplay(moduleImages).map((group) => (
                  <div className="flow-group" key={group.key}>
                    {group.flowName && (
                      <div className="flow-heading">
                        <h3>{group.flowName}</h3>
                        <span>{group.images.length} 步</span>
                      </div>
                    )}
                    <div className="image-grid">
                      {group.images.map((image) => <ImageCard key={image.id} image={image} onOpen={(item) => { if (!busyRef.current) setSelectedImage(item) }} busy={busy}
                        selected={selectedIds.includes(image.id)}
                        onSelect={canDeleteImages ? (id, selected) => setSelectedIds((current) => selected ? [...new Set([...current, id])] : current.filter((item) => item !== id)) : undefined}
                        onMove={canMove ? (item) => { if (busyRef.current) return; setMutationError(null); setMovingImage(item) } : undefined}
                        onDragImage={(id) => { setDraggingId(id); if (!id) setDropTarget(null) }} />)}
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
          images={groupForDisplay(gameImages.filter((image) => image.moduleId === selectedImage.moduleId))
            .find((group) => group.images.some((image) => image.id === selectedImage.id))?.images ?? [selectedImage]}
          initialImageId={selectedImage.id}
          onClose={() => { if (!busyRef.current) setSelectedImage(null) }}
          suspended={Boolean(deletion) || busy}
          onDelete={canDeleteImages ? (image) => requestDeletion([image.id]) : undefined}
          onSetCover={canSetCover && repository.setGameCoverFromImage ? async (image) => {
            if (!gameImages.some((item) => item.id === image.id)) throw new Error('这张图片已不在当前游戏中')
            await mutate(
              () => repository.setGameCoverFromImage!(game.id, image.id),
              () => setSelectedImage(null),
              true,
            )
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
      {movingImage && <MoveImageDialog image={movingImage} modules={modules} busy={busy} error={mutationError}
        onClose={() => { if (!busy) { setMovingImage(null); setMutationError(null) } }}
        onMove={(target) => void moveImage(movingImage, target)} />}
      {deletion && <DeleteConfirmDialog count={deletion.ids.length} target={{ kind: 'images' }} busy={busy} error={mutationError}
        onClose={() => { if (!busy) { setDeletion(null); setMutationError(null) } }} onConfirm={() => void confirmDeletion()} />}
    </main>
  )
}
