/** JSON with // and /* comments and trailing commas, as Wrangler accepts in wrangler.jsonc. */
export function parseJsonc(text: string): unknown {
  let json = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      const end = stringEnd(text, i)
      json += text.slice(i, end + 1)
      i = end
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      json += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) throw new Error('Unterminated comment')
      i = end + 1
    } else json += ch
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'))
}

function stringEnd(text: string, start: number) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  throw new Error('Unterminated string')
}
