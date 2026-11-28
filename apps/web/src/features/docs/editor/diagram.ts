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
    // A cleaner of its own: Mermaid adds its own rules to the one it shares.
    ([mermaid, purify]) => ({ mermaid: mermaid.default, purify: purify.default(window) }),
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
    // A link of a diagram opens nothing but a new tab, where the app opens one (see `diagramLink`).
    FORBID_ATTR: ['target'],
  })
}

/** How long a diagram may take to be drawn: one with a picture that never comes would hold up every other. */
const TOO_LONG = 10_000
/** Drawings already made, by theme and code: a page opened again, or a comment, isn't drawn anew. */
const drawn = new Map<string, Drawing>()
const KEPT = 100
const keyOf = (code: string, light: boolean) => `${light ? 'light' : 'dark'}\u0000${code}`
/** Whether to draw light: always on paper, or when the app is. */
const lightFor = (paper: boolean) => paper || !dark()

/** A drawing of `code` already made, if there is one: what can be shown at once. */
export const drawnBefore = (code: string, paper = false) => drawn.get(keyOf(code, lightFor(paper)))

let count = 0

export type Drawing = { svg: string; id: string } | { error: string }

/**
 * Diagrams are drawn one after another, each with its own settings: Mermaid keeps one set for all, and
 * a diagram's own `%%{init}%%` changes it until it is reset. Its own queue is left out: one that never
 * ends (a picture that never comes) would hold up every other.
 */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(job: () => Promise<T>) {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

/** `code` drawn (light on `paper`, whatever the app's theme): its SVG, cleaned, or why it can't be drawn. */
export async function drawDiagram(code: string, paper = false): Promise<Drawing> {
  const light = lightFor(paper)
  const key = keyOf(code, light)
  const { mermaid, purify } = await load()
  return inTurn(async () => {
    const before = drawn.get(key)
    if (before) {
      // The latest used is the last to go.
      drawn.delete(key)
      drawn.set(key, before)
      return before
    }
    const id = `orq-diagram-${++count}`
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: light ? 'neutral' : 'dark',
        fontFamily: getComputedStyle(document.body).fontFamily,
        secure: SECURE,
        // No picture in a label: Mermaid waits for each to load before it goes on.
        dompurifyConfig: { FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'source'] },
      })
      const tooLong = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('docs:editor.diagram.slow'))), TOO_LONG)
      })
      const { svg } = await Promise.race([mermaid.mermaidAPI.render(id, code), tooLong])
      const drawing = { svg: cleanSvg(purify, svg), id }
      drawn.set(key, drawing)
      if (drawn.size > KEPT) drawn.delete(drawn.keys().next().value!)
      return drawing
    } catch (error) {
      // A setting it was given in `%%{init}%%` that couldn't be read stays in Mermaid's until it is
      // reset, and every other diagram would fail with it.
      try {
        mermaid.mermaidAPI.reset()
      } catch {
        // Nothing more to undo.
      }
      // What it was drawing in, left behind when it couldn't.
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
      // Not kept: drawn again another time, as what failed may not fail then.
      return { error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  })
}

/** A safe address of a link in a drawing (http or https), if it has one. */
export function diagramHref(link: Element) {
  const href = link.getAttribute('href') ?? link.getAttribute('xlink:href')
  return href && /^https?:\/\//i.test(href.trim()) ? href.trim() : null
}

/**
 * Where a link of a diagram leads, for a click on it: nowhere in the editor, where a click puts the
 * cursor in its code, unless with Ctrl (⌘), as any link of the editor. Always in a new tab.
 */
export function diagramLink(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest('a') : null
  if (!link) return false
  event.preventDefault()
  const href = diagramHref(link)
  if (href && (event.metaKey || event.ctrlKey)) window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/** Shows `drawing` in `box`: the drawing, or why there is none, as text. */
export function showDrawing(box: HTMLElement, drawing: Drawing) {
  if ('svg' in drawing) {
    // Shown elsewhere too (a page printed, the same diagram twice): its ids, and what refers to them
    // (an arrow's head), made its own.
    box.innerHTML = drawing.svg.replace(new RegExp(`${drawing.id}(?![0-9])`, 'g'), `orq-diagram-${++count}`)
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

/** Shows a diagram shown, not edited, as `drawing`: its code hidden once it is drawn, shown if it can't be. */
function shownAs(block: HTMLElement, box: HTMLElement, drawing: Drawing) {
  block.toggleAttribute('data-error', !showDrawing(box, drawing))
  block.setAttribute('data-drawn', '')
}

const diagramsIn = (root: ParentNode | null) =>
  [...(root?.querySelectorAll<HTMLElement>('.orq-code[data-diagram]:not([data-drawn]):not([data-drawing])') ?? [])].flatMap((block) => {
    const box = block.querySelector<HTMLElement>('.orq-diagram')
    const code = block.querySelector('pre')?.textContent ?? ''
    return box && code.trim() ? [{ block, box, code }] : []
  })

/** Shows at once the diagrams of `root` already drawn (a page printed from the browser's own menu). */
export function showDrawnBefore(root: ParentNode | null, paper = false) {
  for (const { block, box, code } of diagramsIn(root)) {
    const drawing = drawnBefore(code, paper)
    if (drawing) shownAs(block, box, drawing)
  }
}

/**
 * Draws the diagrams of Markdown shown, not edited (a comment, a page printed): each `.orq-code`
 * markdown-html.ts marked as one, once. Its code stays for copying, shown until it is drawn and where
 * it can't be. Done once all are, or after `waitAtMost` ms, whichever comes first.
 */
export async function drawDiagrams(root: ParentNode | null, { paper = false, waitAtMost = Infinity } = {}) {
  const all = Promise.all(
    diagramsIn(root).map(async ({ block, box, code }) => {
      block.setAttribute('data-drawing', '')
      try {
        shownAs(block, box, await drawDiagram(code, paper))
      } catch {
        // Mermaid couldn't be loaded: the code stays, and another time it is drawn.
      } finally {
        block.removeAttribute('data-drawing')
      }
    }),
  )
  if (waitAtMost === Infinity) return void (await all)
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, waitAtMost))])
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
