// @vitest-environment jsdom
import DOMPurify from 'dompurify'
import i18next from 'i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import docs from '../src/i18n/locales/es/docs.json'
import { cleanSvg, diagramLink, drawDiagram, drawnBefore, isDiagram } from '../src/features/docs/editor/diagram'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'

// Diagrams in Mermaid, as GitHub draws them: the code is what is saved, and its drawing is shown,
// cleaned of anything that could run, load or reach out of it.

describe('a diagram', () => {
  it('is a block of code in Mermaid, its language as written, before any attributes', () => {
    for (const info of ['mermaid', 'Mermaid', 'mermaid {theme=dark}', ' mermaid title="a"']) expect(isDiagram(info), info).toBe(true)
    for (const info of ['', null, 'ts', 'mermaid-js', 'mmd']) expect(isDiagram(info), String(info)).toBe(false)
  })

  it('shown, not edited, has its code to copy and a place for its drawing; its Markdown is the same', () => {
    const markdown = '```mermaid\nflowchart LR\n  A --> B\n```'
    const html = markdownToHtml(markdown)
    expect(html).toMatch(/^<div class="orq-code" data-diagram=""><div class="orq-code-bar"><span class="orq-code-lang"><span>Mermaid<\/span><\/span>/)
    expect(html).toContain('<pre><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre><div class="orq-diagram"></div></div>')
    expect(markdownToHtml('```ts\nconst a = 1\n```')).not.toContain('data-diagram')
  })
})

describe('a drawing, cleaned', () => {
  const clean = (svg: string) => cleanSvg(DOMPurify, svg)

  it('keeps what Mermaid draws: its shapes, its own style, its labels in HTML', () => {
    const svg =
      '<svg id="d1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" role="graphics-document document"><style>#d1 .node rect{fill:#eee}</style><g class="node"><rect width="40" height="20"></rect><foreignObject width="40" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Inicio</span></div></foreignObject></g><path d="M0 0L10 10" marker-end="url(#arrow)"></path></svg>'
    const cleaned = clean(svg)
    for (const part of ['<style>#d1 .node rect{fill:#eee}</style>', '<rect width="40" height="20"></rect>', '<foreignObject', '<span class="nodeLabel">Inicio</span>', 'marker-end="url(#arrow)"', 'viewBox="0 0 100 50"']) expect(cleaned, part).toContain(part)
  })

  it('takes away what runs, loads or sends: scripts, handlers, frames, forms, addresses that run', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g onclick="alert(2)" onload="alert(3)"><a href="javascript:alert(4)"><text>x</text></a></g><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(5)"><iframe src="https://example.com"></iframe><form action="https://example.com"><input name="p"></form><button>b</button><object data="x"></object><embed src="x"></div></foreignObject><use href="data:image/svg+xml,&lt;svg onload=alert(6)&gt;"></use></svg>'
    const cleaned = clean(svg)
    for (const part of ['<script', 'alert', 'onclick', 'onload', 'onerror', 'javascript:', '<iframe', '<form', '<input', '<button', '<object', '<embed', 'data:image/svg']) expect(cleaned, part).not.toContain(part)
    // What is only text stays.
    expect(cleaned).toContain('<text>x</text>')
  })
})

describe('drawing with Mermaid', () => {
  beforeAll(async () => {
    await i18next.init({ lng: 'es', resources: { es: { docs } }, ns: ['docs'] })
    // jsdom lays nothing out: sizes, as a browser would measure them.
    const box = { x: 0, y: 0, width: 60, height: 20, top: 0, left: 0, right: 60, bottom: 20 }
    Object.assign(SVGElement.prototype, {
      getBBox: () => box,
      getComputedTextLength: () => 40,
      getTotalLength: () => 100,
      getPointAtLength: () => ({ x: 0, y: 0 }),
    })
  })

  const svgOf = async (code: string) => {
    const drawing = await drawDiagram(code)
    if (!('svg' in drawing)) throw new Error(drawing.error)
    return drawing.svg
  }

  it('draws a diagram, once: drawn again, it is the same drawing', async () => {
    const svg = await svgOf('flowchart LR\n  Idea --> Plan')
    expect(svg).toContain('Idea')
    expect(drawnBefore('flowchart LR\n  Idea --> Plan')).toEqual({ svg })
    expect(await drawDiagram('flowchart LR\n  Idea --> Plan')).toBe(drawnBefore('flowchart LR\n  Idea --> Plan'))
  }, 20_000)

  it('says why one can\'t be drawn, and one with a setting it can\'t read leaves the others drawn', async () => {
    const wrong = await drawDiagram('flowchart LR\n  A -->')
    expect('error' in wrong && wrong.error).toMatch(/Parse error/)
    const poisoned = await drawDiagram('%%{init: {"theme": "base", "themeVariables": {"primaryColor": "nope"}}}%%\nflowchart LR\n  X --> Y')
    expect('error' in poisoned).toBe(true)
    expect(await svgOf('flowchart LR\n  Uno --> Dos')).toContain('Dos')
  }, 20_000)

  it('runs nothing from what it holds, whatever its own settings ask', async () => {
    const svg = await svgOf(
      [
        '%%{init: {"securityLevel": "loose"}}%%',
        'flowchart LR',
        // No picture: jsdom never loads one, and Mermaid waits for it (in a browser, a missing one fails at once).
        '  A["<b onmouseover=alert(1)>Uno</b>"] --> B["<a href=\'https://example.com\' target=\'x\'>Dos</a>"]',
        '  click A "javascript:alert(3)"',
        '  click B call alert(4)',
      ].join('\n'),
    )
    expect(svg).toContain('Uno')
    for (const part of ['onmouseover', 'onclick', 'javascript:', 'alert', 'target=']) expect(svg, part).not.toContain(part)
  }, 20_000)
})

describe('a link in a drawing', () => {
  it('leads nowhere with a plain click, and to a new tab with Ctrl (⌘)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    // Read as it is dispatched: the event's target is set then.
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true })
    const box = document.createElement('div')
    box.innerHTML = '<svg><a href="https://example.com/login"><text>Entrar</text></a><text>Fuera</text></svg>'
    let handled = false
    box.addEventListener('click', (event) => (handled = diagramLink(event)))
    box.querySelector('a text')!.dispatchEvent(plain)
    expect([handled, plain.defaultPrevented, open.mock.calls.length]).toEqual([true, true, 0])
    box.querySelector('a text')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    expect(open).toHaveBeenCalledWith('https://example.com/login', '_blank', 'noopener,noreferrer')
    const outside = new MouseEvent('click', { bubbles: true, cancelable: true })
    box.querySelectorAll('text')[1]!.dispatchEvent(outside)
    expect([handled, outside.defaultPrevented]).toEqual([false, false])
    open.mockRestore()
  })
})
