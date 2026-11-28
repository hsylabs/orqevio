import { useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Phrases } from '../../components/Phrases'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { downloadFrom } from '../../lib/download'
import { useCodeColours } from './editor/code-languages'
import { showDrawnBefore } from './editor/diagram'
import { markdownToHtml } from './editor/markdown-html'

/**
 * Downloads a page as the server writes it: Markdown alone, or a ZIP with its files and, when
 * asked, its subpages.
 */
export const downloadPage = (pageId: string, subpages: boolean) => downloadFrom(`/api/pages/${pageId}/download${subpages ? '?subpages=1' : ''}`)

/** Whether to take a page's subpages along with it, asked before downloading a page that has some. */
export function DownloadDialog({ open, title, onOpenChange, onChoose }: { open: boolean; title: string; onOpenChange: (open: boolean) => void; onChoose: (subpages: boolean) => void }) {
  const { t } = useTranslation('docs')
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('page.downloadAsk.title', { title })}
      description={t('page.downloadAsk.description')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onChoose(false)}>
            {t('page.downloadAsk.only')}
          </Button>
          <Button variant="primary" onClick={() => onChoose(true)}>
            {t('page.downloadAsk.withSubpages')}
          </Button>
        </>
      }
    >
      <span />
    </Dialog>
  )
}

/** Waits for the pictures in `root` to be ready to print, or for a few seconds, whichever comes first. */
export async function picturesReady(root: ParentNode | null, waitAtMost = 3000) {
  const pictures = [...(root?.querySelectorAll('img') ?? [])]
  await Promise.race([Promise.all(pictures.map((img) => img.decode().catch(() => {}))), new Promise((resolve) => setTimeout(resolve, waitAtMost))])
}

/**
 * A page as it prints or is saved as PDF: its title and its text, read from its Markdown as the
 * editor reads it, alone on white paper whatever the theme (see `.orq-print` in editor.css). It
 * takes the place of everything else only while it is there, so printing any other page is as before.
 */
export function PrintView({ title, icon, markdown }: { title: string; icon: string | null; markdown: string }) {
  const colours = useCodeColours()
  const html = useMemo(() => markdownToHtml(markdown), [markdown, colours])
  const text = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    document.documentElement.classList.add('orq-printing')
    return () => document.documentElement.classList.remove('orq-printing')
  }, [])
  useLayoutEffect(() => {
    // On paper nothing opens: every toggle is shown open.
    for (const details of text.current?.querySelectorAll('details') ?? []) details.open = true
    // Its diagrams already drawn, at once: printed from the browser's own menu, nothing is waited for.
    showDrawnBefore(text.current, true)
    // On paper there is nothing to click: each link shows where it leads, in full, unless its text already says it.
    for (const link of text.current?.querySelectorAll('a[href]') ?? []) {
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('#')) continue
      let address: string
      try {
        address = new URL(href, window.location.href).href
      } catch {
        continue
      }
      const shown = link.textContent?.trim() ?? ''
      if (shown !== address && shown !== href && `mailto:${shown}` !== href) link.setAttribute('data-address', address.replace(/^mailto:/, ''))
    }
  }, [html])
  return createPortal(
    <div className="orq-print-root">
      <article className="orq-print">
        <h1 className="orq-print-title">
          {icon ? `${icon} ` : ''}
          <Phrases text={title} />
        </h1>
        <div ref={text} className="orq-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>,
    document.body,
  )
}
