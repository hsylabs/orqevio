import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../../lib/cn'

/**
 * A small drawing of what a block of the «/» menu looks like, beside the option it is on, as
 * Notion's previews are. Drawn rather than pictured, so that it follows the theme and needs no
 * words: lines stand for text, and only what a block shows itself (a heading's «Aa», a number,
 * a formula) is written.
 */

/** A line of text, `width` of the room. */
function Line({ width, strong = false, style }: { width: string; strong?: boolean; style?: CSSProperties }) {
  return <span className={strong ? 'block h-[7px] rounded-full bg-ink-3/60' : 'block h-[6px] rounded-full bg-ink-3/30'} style={{ width, ...style }} />
}

function Lines({ widths }: { widths: string[] }) {
  return (
    <span className="flex flex-col gap-[7px]">
      {widths.map((width, i) => (
        <Line key={i} width={width} />
      ))}
    </span>
  )
}

/** Rows that each start with a marker: a bullet, a number, a box. */
function Rows({ marker }: { marker: (i: number) => ReactNode }) {
  return (
    <span className="flex flex-col gap-[9px]">
      {['72%', '58%', '66%'].map((width, i) => (
        <span key={i} className="flex items-center gap-2">
          <span className="grid w-3.5 shrink-0 place-items-center text-[11px] leading-none text-ink-2">{marker(i)}</span>
          <Line width={width} />
        </span>
      ))}
    </span>
  )
}

const HEADING_SIZES: Record<string, number> = { h1: 30, h2: 24, h3: 20, h4: 17, h5: 15, h6: 13 }
/** A type specimen, the same in every language. */
const SPECIMEN = 'Aa'

const PREVIEWS: Record<string, () => ReactNode> = {
  p: () => <Lines widths={['92%', '100%', '84%', '60%']} />,
  ul: () => <Rows marker={() => '•'} />,
  ol: () => <Rows marker={(i) => `${i + 1}.`} />,
  todo: () => (
    <Rows
      marker={(i) => (
        <span className={i === 0 ? 'grid size-3 place-items-center rounded-[3px] bg-accent text-[8px] text-white' : 'size-3 rounded-[3px] border border-ink-3/70'}>{i === 0 ? '✓' : ''}</span>
      )}
    />
  ),
  quote: () => (
    <span className="flex gap-2.5 border-l-[3px] border-ink-3/50 pl-2.5">
      <Lines widths={['94%', '100%', '70%']} />
    </span>
  ),
  callout: () => (
    <span className="flex gap-2 rounded-[6px] border-l-[3px] p-2" style={{ borderColor: 'var(--c-teal)', background: 'color-mix(in oklab, var(--c-teal) 10%, transparent)' }}>
      <span className="text-[11px] leading-none" style={{ color: 'var(--c-teal)' }}>
        ⓘ
      </span>
      <span className="flex-1">
        <Lines widths={['90%', '64%']} />
      </span>
    </span>
  ),
  toggle: () => (
    <span className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-ink-2">▾</span>
        <Line width="56%" strong />
      </span>
      <span className="pl-4">
        <Lines widths={['88%', '70%']} />
      </span>
    </span>
  ),
  code: () => (
    <span className="flex flex-col gap-[7px] rounded-[6px] bg-ink/[0.06] p-2.5 font-mono">
      <span className="flex gap-1.5">
        <Line width="22%" style={{ background: 'var(--c-iris)', opacity: 0.7 }} />
        <Line width="34%" />
      </span>
      <span className="flex gap-1.5 pl-3">
        <Line width="18%" style={{ background: 'var(--c-teal)', opacity: 0.7 }} />
        <Line width="40%" />
      </span>
      <Line width="12%" />
    </span>
  ),
  math: () => <span className="block text-center font-serif text-[20px] text-ink italic">a² + b² = c²</span>,
  inlineMath: () => (
    <span className="flex items-center gap-1.5">
      <Line width="30%" />
      <span className="font-serif text-[15px] text-ink italic">x²</span>
      <Line width="40%" />
    </span>
  ),
  table: () => (
    <span className="grid grid-cols-3 overflow-hidden rounded-[4px] border border-line-strong">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cn('h-5 border-line-strong', i % 3 < 2 && 'border-r', i < 6 && 'border-b', i < 3 && 'bg-ink/[0.05]')} />
      ))}
    </span>
  ),
  hr: () => (
    <span className="flex flex-col gap-3">
      <Line width="80%" />
      <span className="block h-px w-full bg-line-strong" />
      <Line width="64%" />
    </span>
  ),
  mention: () => (
    <span className="flex items-center gap-1.5">
      <Line width="26%" />
      <span className="rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[11px] leading-none font-medium text-accent-text">@</span>
      <Line width="34%" style={{ background: 'var(--accent)', opacity: 0.45 }} />
    </span>
  ),
  mermaid: () => (
    <span className="flex items-center gap-1 py-2">
      {['A', 'B', 'C'].map((name, i) => (
        <span key={name} className="flex flex-1 items-center gap-1">
          {i > 0 && <span className="text-[11px] leading-none text-ink-3">→</span>}
          <span className="grid h-7 flex-1 place-items-center rounded-[5px] border border-line-strong bg-ink/[0.04] text-[10px] leading-none font-medium text-ink-2">{name}</span>
        </span>
      ))}
    </span>
  ),
  emoji: () => (
    <span className="flex flex-col gap-2.5">
      <span className="flex items-center gap-1.5">
        <Line width="34%" />
        <span className="text-[17px] leading-none">🚀</span>
        <Line width="22%" />
      </span>
      <span className="flex gap-2 text-[17px] leading-none">
        {['😀', '👍', '🎉', '❤️', '🔥'].map((emoji) => (
          <span key={emoji}>{emoji}</span>
        ))}
      </span>
    </span>
  ),
  page: () => (
    <span className="flex flex-col gap-2.5">
      <Line width="70%" />
      <span className="flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-2" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </svg>
        <Line width="48%" style={{ background: 'var(--accent)', opacity: 0.55 }} />
      </span>
      <Line width="56%" />
    </span>
  ),
  image: () => (
    <span className="grid h-[68px] place-items-center rounded-[6px] bg-ink/[0.06]">
      <svg viewBox="0 0 24 24" className="size-7 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="m4 18 5-5 3 3 3-3 5 5" />
      </svg>
    </span>
  ),
  file: () => (
    <span className="flex items-center gap-2 rounded-[6px] border border-line-strong px-2 py-2">
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
      <Line width="60%" strong />
    </span>
  ),
}

for (const level of Object.keys(HEADING_SIZES)) {
  PREVIEWS[level] = () => (
    <span className="flex flex-col gap-2">
      <span className="block leading-none font-semibold text-ink" style={{ fontSize: HEADING_SIZES[level] }}>
        {SPECIMEN}
      </span>
      <Lines widths={['90%', '68%']} />
    </span>
  )
}

// A toggle whose title is a heading: the heading, with its arrow, over what it folds.
for (const level of [1, 2, 3]) {
  PREVIEWS[`toggleH${level}`] = () => (
    <span className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-ink-2">▾</span>
        <span className="block leading-none font-semibold text-ink" style={{ fontSize: HEADING_SIZES[`h${level}`] }}>
          {SPECIMEN}
        </span>
      </span>
      <span className="pl-4">
        <Lines widths={['88%', '70%']} />
      </span>
    </span>
  )
}

/** Whether there is a drawing of the block. */
export const hasSlashPreview = (id: string | undefined) => id !== undefined && id in PREVIEWS

export function SlashPreview({ id }: { id: string }) {
  const draw = PREVIEWS[id]
  return draw ? draw() : null
}
