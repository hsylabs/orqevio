import { type FormEvent, type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Field } from './Field'

interface PromptOptions {
  title: string
  description?: ReactNode
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
}

const PromptContext = createContext<(opts: PromptOptions) => Promise<string | null>>(async () => null)

/** Promise-based single-field prompt: `const name = await prompt({...})`. */
export function PromptProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [opts, setOpts] = useState<PromptOptions | null>(null)
  const [value, setValue] = useState('')
  const resolver = useRef<(value: string | null) => void>(() => {})
  const prompt = useCallback((o: PromptOptions) => {
    setOpts(o)
    setValue(o.initialValue ?? '')
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve
    })
  }, [])
  const close = (result: string | null) => {
    resolver.current(result)
    setOpts(null)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) close(value.trim())
  }
  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog open={opts !== null} onOpenChange={(open) => !open && close(null)} title={opts?.title ?? ''} description={opts?.description}>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field
            label={opts?.label ?? ''}
            value={value}
            placeholder={opts?.placeholder}
            maxLength={opts?.maxLength ?? 120}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!value.trim()}>
              {opts?.confirmLabel ?? t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </PromptContext.Provider>
  )
}

export const usePrompt = () => useContext(PromptContext)
