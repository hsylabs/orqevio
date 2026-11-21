import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'

/** Where notices show: named in the language shown, as screen readers announce it (it said "Notifications" in all of them). */
export function Notices() {
  const { t } = useTranslation('shell')
  return (
    <Toaster
      containerAriaLabel={t('notifications')}
      position="bottom-right"
      gap={8}
      // A sheet or a dialog open leaves the rest of the page unclickable: a notice's action (undo a
      // deletion made in the sheet) still takes the click.
      style={{ pointerEvents: 'auto' }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[356px] items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[13.5px] text-ink shadow-lg',
          title: 'font-medium',
          description: 'text-[12.5px] text-ink-2 mt-0.5',
          icon: 'mt-0.5',
          actionButton: 'ml-auto shrink-0 rounded-[8px] bg-ink px-2.5 py-1 text-[12px] font-medium text-sheet',
          success: '[&_[data-icon]]:text-ok',
          error: '[&_[data-icon]]:text-danger',
        },
      }}
    />
  )
}
