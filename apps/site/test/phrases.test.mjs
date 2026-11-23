import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withPhrases } from '../phrases.mjs'

const src = path.resolve(import.meta.dirname, '../src')

const marked = (html) => withPhrases(html).replaceAll('<wbr>', '|')

describe('Japanese split into phrases at build time', () => {
  it('puts a place to break between the phrases of a paragraph, and changes nothing else', () => {
    expect(marked('<h3>あなたにしか読めないパスワード</h3>')).toBe('<h3>あなたにしか|読めない|パスワード</h3>')
    // Where two phrases meet at an element, the place to break starts the text that follows.
    expect(marked('<p>次の<em>手順</em>で</p>')).toBe('<p>次の<em>|手順</em>で</p>')
  })

  it('makes no break next to a phrase of a single letter, where BudouX is unsure', () => {
    expect(marked('<th scope="col">インストール方法</th><th>残りの削除方法</th><th>インストール方法：</th>')).toBe(
      '<th scope="col">インストール方法</th><th>残りの|削除方法</th><th>インストール方法：</th>',
    )
    expect(marked('<p>それでもうまくいかない場合</p>')).toMatch(/それでもうまく/)
    // After code, a single letter is a particle: it goes with the code, and a line may start after it.
    expect(marked('<p><code>.env</code>に<code>TRUST_PROXY=true</code>を追加してください。</p>')).toMatch(/<\/code>を\|追加/)
  })

  it('starts no line with closing punctuation and ends none with an opening bracket', () => {
    const out = marked('<p>その後は：<code>npx create-orqevio</code></p><p>公開アドレス（例：あなたの名前）を決めます。</p><p>「保管庫」を開きます。</p>')
    expect(out).not.toMatch(/\|[、。：）」]/)
    expect(out).not.toMatch(/[（「]\|/)
  })

  it('keeps a number with what it counts', () => {
    expect(marked('<p>1日あたり100万回のリクエストまで無料です。</p>')).not.toMatch(/\d\|/)
  })

  it('reads code as part of the sentence around it, and leaves it as written', () => {
    const out = marked('<p>シークレット<code>SETUP_CODE</code>で、あなただけのOrqevioをセットアップします。</p>')
    expect(out).toContain('<code>SETUP_CODE</code>')
    expect(out.replace(/<code>.*<\/code>/, '')).toMatch(/\|/)
  })

  it('keeps unknown or impossible entities, and a ">" inside a quoted attribute', () => {
    for (const html of ['<p>保管庫&hellip;あなたにしか読めない&#x110000;パスワード</p>', '<span title="注意>あなたにしか読めない">保管庫</span>', '<p>a < b あなたにしか読めない</p><']) {
      expect(withPhrases(html).replaceAll('<wbr>', '')).toBe(html)
    }
    expect(withPhrases('<span title="注意>あなたにしか読めない">保管庫</span>')).toBe('<span title="注意>あなたにしか読めない">保管庫</span>')
  })

  it('changes nothing but the places to break in the Japanese pages and layout', () => {
    const files = [...readdirSync(path.join(src, 'pages/ja')).map((f) => path.join(src, 'pages/ja', f)), path.join(src, 'layout.html')]
    for (const file of files) {
      const html = readFileSync(file, 'utf8')
      expect(withPhrases(html).replaceAll('<wbr>', ''), file).toBe(html)
    }
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
