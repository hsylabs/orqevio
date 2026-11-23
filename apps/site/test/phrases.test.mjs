import { describe, expect, it } from 'vitest'
import { withPhrases } from '../phrases.mjs'

const marked = (html) => withPhrases(html).replaceAll('<wbr>', '|')

describe('Japanese split into phrases at build time', () => {
  it('puts a place to break between the phrases of a paragraph, and changes nothing else', () => {
    expect(marked('<h3>あなたにしか読めないパスワード</h3>')).toBe('<h3>あなたにしか|読めない|パスワード</h3>')
    // Where two phrases meet at an element, the place to break starts the text that follows.
    expect(marked('<p>次の<em>手順</em>で</p>')).toBe('<p>次の<em>|手順</em>で</p>')
  })

  it('keeps the last letter of a paragraph with the phrase before it', () => {
    expect(marked('<th scope="col">インストール方法</th><th>残りの削除方法</th>')).toBe('<th scope="col">インストール方法</th><th>残りの|削除方法</th>')
  })

  it('reads a paragraph across the elements inside it, and leaves the elements as they are', () => {
    expect(marked('<li><strong>ゼロ知識の保管庫。</strong>ブラウザ内で<a href="/ja/#x" class="link">暗号化</a>します。</li>')).toBe(
      '<li><strong>ゼロ知識の|保管庫。</strong>|ブラウザ内で<a href="/ja/#x" class="link">|暗号化</a>します。</li>',
    )
  })

  it('leaves code, commands and the head as written, and attributes too', () => {
    const html = [
      '<head><title>あなたにしか読めないパスワード</title><meta name="description" content="あなたにしか読めないパスワード" /></head>',
      '<p title="あなたにしか読めないパスワード">次の<code>npx create-orqevio</code>を実行します。</p>',
      '<div class="command"><pre><code><span class="prompt">$ </span>docker compose up -d # 保管庫を起動します</code></pre></div>',
    ].join('')
    const out = marked(html)
    expect(out).toContain('<head><title>あなたにしか読めないパスワード</title><meta name="description" content="あなたにしか読めないパスワード" /></head>')
    expect(out).toContain('<p title="あなたにしか読めないパスワード">')
    expect(out).toContain('<code>npx create-orqevio</code>')
    expect(out).toContain('<pre><code><span class="prompt">$ </span>docker compose up -d # 保管庫を起動します</code></pre>')
  })

  it('does not cut a word or a number of a spaced script, nor a character drawn from several code points', () => {
    const out = marked('<p>お使いのCloudflareアカウントで、2026年11月に、160ビットのキー👨‍👩‍👧を作ります。</p>')
    for (const whole of ['Cloudflare', '2026', '160', '👨‍👩‍👧']) expect(out, whole).toContain(whole)
  })

  it('keeps entities whole, and leaves text in other scripts alone', () => {
    expect(marked('<p>タスク&amp;ドキュメントを&nbsp;保管庫に</p>').replaceAll('|', '')).toBe('<p>タスク&amp;ドキュメントを&nbsp;保管庫に</p>')
    expect(marked('<p>タスク&amp;ドキュメントを&nbsp;保管庫に</p>')).not.toMatch(/&[^;]*\|/)
    const latin = '<p>Your own workspace, in your own copy.</p><a href="/" lang="ja">日本語</a>'
    expect(withPhrases(latin)).toBe(latin)
  })

  it('breaks no paragraph at a line break or a block, so each is read on its own', () => {
    expect(marked('<h1>整理する。<br />記録する。<br /><em>守る。</em></h1>')).toBe('<h1>整理する。<br />記録する。<br /><em>守る。</em></h1>')
  })
})
