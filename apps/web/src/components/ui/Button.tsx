import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'agent'
type Size = 'xs' | 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-sheet shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.2)] hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--sheet))] active:translate-y-px',
  accent:
    'bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.15)] hover:bg-accent-strong active:translate-y-px',
  secondary: 'border border-line bg-surface text-ink shadow-sm hover:border-line-strong hover:bg-[color-mix(in_oklab,var(--surface)_96%,var(--ink))]',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-press',
  danger: 'bg-danger text-white hover:brightness-110 active:translate-y-px',
  agent: 'bg-agent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] hover:brightness-110 active:translate-y-px',
}

const sizes: Record<Size, string> = {
  xs: 'h-6 gap-1 rounded-[7px] px-2 text-[12px]',
  sm: 'h-7.5 gap-1.5 rounded-[8px] px-2.5 text-[13px]',
  md: 'h-9 gap-2 rounded-[10px] px-3.5 text-[13.5px]',
  lg: 'h-11 gap-2 rounded-[12px] px-5 text-[15px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,transform,filter,box-shadow] duration-150 select-none disabled:opacity-50 [&_svg]:size-[15px] [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        iconOnly && 'aspect-square px-0',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-[15px]" /> : icon}
      {!iconOnly && children}
    </button>
  )
})
