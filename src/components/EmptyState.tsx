import { ArrowLeft, FolderSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

interface EmptyStateProps {
  eyebrow?: string
  title: string
  description: string
  actionLabel?: string
  actionTo?: string
  compact?: boolean
}

export function EmptyState({
  eyebrow = 'NOTHING HERE',
  title,
  description,
  actionLabel,
  actionTo,
  compact = false,
}: EmptyStateProps) {
  return (
    <section className={`empty-state${compact ? ' empty-state--compact' : ''}`}>
      <div className="empty-state-icon"><FolderSearch size={25} /></div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      {actionLabel && actionTo && (
        <Link className="secondary-button" to={actionTo}><ArrowLeft size={17} /> {actionLabel}</Link>
      )}
    </section>
  )
}
