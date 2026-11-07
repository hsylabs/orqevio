import type { ReactNode } from 'react'

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-rise mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-5 grid size-14 place-items-center rounded-[16px] border border-line bg-surface text-ink-3 shadow-sm [&_svg]:size-6">{icon}</div>
      )}
      <h3 className="font-display text-[20px] font-medium">{title}</h3>
      {children && <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
