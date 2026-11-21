import type { ProjectColor } from '@orqevio/shared'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { colorStyle } from '../lib/colors'

/** A project's monogram on its colour, one of the palette or its own. */
export function ProjectGlyph({ color, className, children }: { color: ProjectColor; className?: string; children: ReactNode }) {
  const look = colorStyle(color)
  return (
    <span className={cn('glyph', look.className, className)} style={look.style}>
      {children}
    </span>
  )
}
