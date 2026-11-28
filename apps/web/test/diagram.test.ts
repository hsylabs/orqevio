// @vitest-environment jsdom
import DOMPurify from 'dompurify'
import { describe, expect, it } from 'vitest'
import { cleanSvg, isDiagram } from '../src/features/docs/editor/diagram'
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
