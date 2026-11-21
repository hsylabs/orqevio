// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'

// Comments are shown as HTML written from the editor's schema: what an agent writes in one can't
// run anything, and reads as it would in the editor.
describe('a comment shown as HTML', () => {
  it('keeps the addresses the editor allows and leaves the others without one', () => {
    const html = markdownToHtml('[web](https://a.test) [correo](mailto:a@b.test) [tarjeta](/card/x) [mal](javascript:alert(1)) [datos](data:text/html,hola) [ancla](#sec)')
    expect(html).toContain('href="https://a.test"')
    expect(html).toContain('href="mailto:a@b.test"')
    expect(html).toContain('href="/card/x"')
    expect(html).not.toMatch(/javascript:|data:text/)
    // The others are no links: no address, nothing to follow or to tab to.
    expect(html).not.toContain('href=""')
    expect(html.match(/<a rel="[^"]*">/g)).toHaveLength(3)
  })

  it("keeps only a code block's language as its class", () => {
    expect(markdownToHtml('```js fixed inset-0 z-50\nx\n```')).toContain('<code class="language-js">')
    expect(markdownToHtml('```"><b>\nx\n```')).not.toContain('<b>')
  })

  it('shows raw HTML as text', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)>\n\nY <b onclick="x()">esto</b>')
    expect(html).not.toMatch(/<img|<b /)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('shows task boxes that cannot be ticked, and leaves no empty paragraph at the end', () => {
    const html = markdownToHtml('- [ ] llamar\n- [x] hecho')
    expect(html.match(/<input type="checkbox" disabled/g)).toHaveLength(2)
    expect(html).not.toMatch(/<p><\/p>$/)
  })

  it('reads Markdown as the editor does, and gives the same text the same HTML', () => {
    const markdown = '**negrita**, `código` y\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    const html = markdownToHtml(markdown)
    expect(html).toContain('<strong>negrita</strong>')
    expect(html).toContain('<code>código</code>')
    expect(html).toContain('<table')
    expect(markdownToHtml(markdown)).toBe(html)
  })
})
