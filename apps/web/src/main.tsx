import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { ConfirmProvider } from './components/ui/confirm'
import { PromptProvider } from './components/ui/prompt'
import { TooltipProvider } from './components/ui/Tooltip'
import { queryClient } from './lib/queries'
import { router } from './router'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <PromptProvider>
            <RouterProvider router={router} />
          </PromptProvider>
          <Toaster
            position="bottom-right"
            gap={8}
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
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
