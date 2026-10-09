import { ArrowUpRight, Image as ImageIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import type { Game } from '../domain/models'

interface GameCardProps {
  game: Game
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
})

export function GameCard({ game }: GameCardProps) {
  return (
    <article className="game-card" style={{ '--cover-tone': game.coverTone } as CSSProperties}>
      <Link className="game-card-cover" to={`/game/${game.id}`} aria-label={`打开 ${game.name}`}>
        {game.coverUrl ? <img src={game.coverUrl} alt="" /> : <span>{game.name.slice(0, 2)}</span>}
        <span className="game-card-open"><ArrowUpRight size={18} /></span>
      </Link>
      <div className="game-card-body">
        <div className="game-card-titleline">
          <div>
            <h2>{game.name}</h2>
            <p>{game.aliases[0] ?? game.developer}</p>
          </div>
          <span className="image-count"><ImageIcon size={14} /> {game.imageCount}</span>
        </div>
        <div className="chip-row">
          {game.platforms.slice(0, 2).map((platform) => <span className="chip" key={platform}>{platform}</span>)}
          {game.platforms.length > 2 && <span className="chip">+{game.platforms.length - 2}</span>}
        </div>
        <div className="game-card-footer">
          <span>{game.tags.slice(0, 2).join(' · ')}</span>
          <time dateTime={game.updatedAt}>{dateFormatter.format(new Date(game.updatedAt))} 更新</time>
        </div>
      </div>
    </article>
  )
}
