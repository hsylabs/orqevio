import type DOMPurify from 'dompurify'
import type MermaidModule from 'mermaid'
import { t } from 'i18next'
import { languageOf } from './code-languages'

/**
 * Diagrams written in Mermaid, as GitHub draws them: a code block whose language is `mermaid`. Its
 * code is what is saved, and the drawing is shown with it, or in its place. Mermaid comes apart from
 * the editor, the first time a diagram is shown.
 *
 * What is drawn comes from what anyone who can edit a page wrote, so it is drawn with Mermaid's
 * `strict` level (no click runs anything, its labels' HTML cleaned), cleaned once more as SVG here,
 * and shown in a box it can't paint outside of (editor.css). The app's own CSP runs no script in it.
 */

/** Whether a code block with this info string is a diagram. */
export const isDiagram = (info: string | null | undefined) => languageOf(info).toLowerCase() === 'mermaid'

type Mermaid = typeof MermaidModule
type Purify = typeof DOMPurify

let library: Promise<{ mermaid: Mermaid; purify: Purify }> | null = null
function load() {
  library ??= Promise.all([import('mermaid'), import('dompurify')]).then(
    ([mermaid, purify]) => ({ mermaid: mermaid.default, purify: purify.default }),
    (error: unknown) => {
      // Offline or a new version deployed since: the next diagram tries again.
      library = null
      throw error
    },
  )
  return library
}

/** The system's light or dark, where it can be asked (not in every browser that runs no page). */
const systemScheme = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

/** Whether the app is shown dark: its own choice, or the system's. */
const dark = () => {
  const theme = document.documentElement.dataset.theme
  return theme ? theme === 'dark' : !!systemScheme()?.matches
}

/** What a diagram's own `%%{init}%%` can't change: Mermaid's own list, its CSS and its fonts. */
const SECURE = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS', 'fontFamily', 'altFontFamily']

/**
 * A drawing cleaned as SVG that may hold its labels' HTML (in `foreignObject`): no script, no event
 * handler, no form, nothing that loads a page, no address that runs anything.
 */
export function cleanSvg(purify: Purify, svg: string) {
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    // Its labels' HTML, cleaned as any HTML, inside the SVG element that holds it.
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
  })
}

let count = 0

export type Drawing = { svg: string } | { error: string }

/** `code` drawn: its SVG, cleaned, or why Mermaid can't draw it. */
export async function drawDiagram(code: string): Promise<Drawing> {
  const { mermaid, purify } = await load()
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: dark() ? 'dark' : 'neutral',
    fontFamily: getComputedStyle(document.body).fontFamily,
    secure: SECURE,
  })
  const id = `orq-diagram-${++count}`
  try {
    const { svg } = await mermaid.render(id, code)
    return { svg: cleanSvg(purify, svg) }
  } catch (error) {
    // What it was drawing in, left behind when it couldn't.
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Shows `drawing` in `box`: the drawing, or why there is none, as text. */
export function showDrawing(box: HTMLElement, drawing: Drawing) {
  if ('svg' in drawing) {
    box.innerHTML = drawing.svg
    return true
  }
  const title = document.createElement('p')
  title.className = 'orq-diagram-error-title'
  title.textContent = t('docs:editor.diagram.error')
  const reason = document.createElement('pre')
  reason.className = 'orq-diagram-error'
  reason.textContent = drawing.error
  box.replaceChildren(title, reason)
  return false
}

/**
 * Draws the diagrams of Markdown shown, not edited (a comment, a page printed): each `.orq-code`
 * markdown-html.ts marked as one, once. Its code stays for copying and is shown where it can't be drawn.
 */
export async function drawDiagrams(root: ParentNode | null) {
  const boxes = [...(root?.querySelectorAll<HTMLElement>('.orq-code[data-diagram]:not([data-drawn])') ?? [])]
  await Promise.all(
    boxes.map(async (block) => {
      const box = block.querySelector<HTMLElement>('.orq-diagram')
      const code = block.querySelector('pre')?.textContent ?? ''
      if (!box || !code.trim()) return
      block.setAttribute('data-drawn', '')
      try {
        if (!showDrawing(box, await drawDiagram(code))) block.setAttribute('data-error', '')
      } catch {
        // Mermaid couldn't be loaded: the code stays, and another time it is drawn.
        block.removeAttribute('data-drawn')
      }
    }),
  )
}

/** Calls `listener` whenever the app turns light or dark; returns how to stop. */
export function onThemeChange(listener: () => void) {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  const system = systemScheme()
  system?.addEventListener('change', listener)
  return () => {
    observer.disconnect()
    system?.removeEventListener('change', listener)
  }
}
