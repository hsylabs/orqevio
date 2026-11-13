import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LogoMark } from '../../components/Logo'
import { Button } from '../../components/ui/Button'

export function FullScreenLoader() {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center bg-desk" aria-busy="true" aria-label={t('loading')}>
      <LogoMark size={36} className="animate-pulse" />
    </div>
  )
}

export function NotFound({ standalone }: { standalone?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={standalone ? 'grid min-h-dvh place-items-center bg-desk px-6' : 'grid h-full place-items-center px-6'}>
      <div className="animate-rise text-center">
        <p className="font-mono text-[12px] tracking-[0.2em] text-ink-3">404</p>
        <h1 className="mt-3 font-display text-[34px] font-medium">{t('notFound.title')}</h1>
        <p className="mt-2 text-ink-2">{t('notFound.body')}</p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="primary">{t('actions.backHome')}</Button>
        </Link>
      </div>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pt-16" aria-busy="true">
      <div className="skeleton h-10 w-2/3" />
      <div className="skeleton mt-6 h-4 w-full" />
      <div className="skeleton mt-3 h-4 w-5/6" />
      <div className="skeleton mt-3 h-4 w-4/6" />
    </div>
  )
}
