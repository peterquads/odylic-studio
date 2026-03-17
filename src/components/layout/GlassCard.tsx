import type { ReactNode } from 'react'

export function GlassCard({
  children,
  className = '',
  onClick,
  hover = false,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`glass p-5 ${hover ? 'glass-hover cursor-pointer transition-all duration-200' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function GlassBadge({
  children,
  color = 'default',
  className = '',
}: {
  children: ReactNode
  color?: 'default' | 'accent' | 'success' | 'warning' | 'error'
  className?: string
}) {
  const colors = {
    default: 'bg-black/[0.04] text-text-secondary border border-black/[0.06]',
    accent: 'bg-black/[0.06] text-text-primary border border-black/[0.08]',
    success: 'bg-success/10 text-success border border-success/15',
    warning: 'bg-warning/10 text-warning border border-warning/15',
    error: 'bg-error/10 text-error border border-error/15',
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]} ${className}`}
    >
      {children}
    </span>
  )
}
