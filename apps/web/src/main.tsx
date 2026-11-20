import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ConfirmProvider } from './components/ui/confirm'
import { Notices } from './components/ui/Notices'
import { PromptProvider } from './components/ui/prompt'
import { TooltipProvider } from './components/ui/Tooltip'
import { setupI18n } from './i18n'
import { followAccountLocale } from './i18n/account'
import { queryClient } from './lib/queries'
import { router } from './router'
import './styles/app.css'

await setupI18n()
followAccountLocale(queryClient)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <PromptProvider>
            <RouterProvider router={router} />
          </PromptProvider>
          <Notices />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
