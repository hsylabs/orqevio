import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Every language must say everything English says, in the plural forms its
 * grammar needs, and no text may reach the screen without going through a catalog.
 */

const root = path.resolve(import.meta.dirname, '../src')
const localesDir = path.join(root, 'i18n/locales')
const locales = readdirSync(localesDir).sort()
const namespaces = readdirSync(path.join(localesDir, 'en')).map((f) => f.replace(/\.json$/, '')).sort()

type Catalog = { [key: string]: string | Catalog }
const load = (locale: string, ns: string): Catalog => JSON.parse(readFileSync(path.join(localesDir, locale, `${ns}.json`), 'utf8'))

function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === 'string') out[prefix + key] = value
    else Object.assign(out, flatten(value, `${prefix}${key}.`))
  }
  return out
}

const PLURAL = /_(zero|one|two|few|many|other)$/
/** A key as the code uses it: plural keys share one base, `count_one` and `count_other` are `count`. */
const base = (key: string) => key.replace(PLURAL, '')
const variables = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort()
const tags = (text: string) => [...text.matchAll(/<\/?([\w]+)\s*\/?>/g)].map((m) => m[0]).sort()

describe('catalogs', () => {
  it('exist for every namespace in every language', () => {
    for (const locale of locales) expect(readdirSync(path.join(localesDir, locale)).map((f) => f.replace(/\.json$/, '')).sort(), locale).toEqual(namespaces)
  })

  for (const locale of locales) {
    it(`${locale}: has every text of English, with the same variables and tags, in every plural form`, () => {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
      for (const ns of namespaces) {
        const reference = flatten(load('en', ns))
        const catalog = flatten(load(locale, ns))
        const plurals = new Set(Object.keys(reference).filter((k) => PLURAL.test(k)).map(base))
        const expected = new Set<string>()
        for (const key of Object.keys(reference)) {
          if (!plurals.has(base(key))) expected.add(key)
          else for (const category of categories) expected.add(`${base(key)}_${category}`)
        }
        const where = `${locale}/${ns}.json`
        expect(Object.keys(catalog).filter((k) => !expected.has(k)), `${where}: keys English lacks`).toEqual([])
        expect([...expected].filter((k) => !(k in catalog)), `${where}: missing keys`).toEqual([])
        for (const [key, text] of Object.entries(catalog)) {
          expect(text.trim(), `${where}: ${key} is empty`).not.toBe('')
          const english = reference[key] ?? reference[`${base(key)}_other`]!
          expect(variables(text), `${where}: variables of ${key}`).toEqual(variables(english))
          expect(tags(text), `${where}: tags of ${key}`).toEqual(tags(english))
        }
      }
    })
  }
})

/** Words that read the same in every language. */
const UNTRANSLATED = new Set(['Orqevio', 'MCP', 'OAuth', 'Claude', 'GitHub', 'Bitwarden', 'Markdown', 'Ctrl', 'Esc', 'TOTP', 'URL', 'API', 'JSON', 'CSV', 'HSY Labs'])
/** Attributes and props whose text people read. */
const TEXT_PROPS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-description', 'aria-valuetext', 'label', 'description', 'hint', 'error', 'confirmLabel', 'cancelLabel', 'empty', 'emptyText', 'message', 'tooltip', 'heading', 'subtitle'])

const hasText = (text: string) => {
  const words = text.replace(/\{[^}]*\}/g, ' ').trim()
  if (!/\p{L}{2,}/u.test(words)) return false
  return !words.split(/[\s·,.:;!?()/|—–-]+/).filter(Boolean).every((w) => UNTRANSLATED.has(w) || !/\p{L}{2,}/u.test(w))
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

export function hardcodedText(file: string) {
  const code = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const report = (node: ts.Node, text: string) => found.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${text.trim().slice(0, 70)}`)
  const literalText = (node: ts.Node | undefined): string | null => {
    if (!node) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ')
    if (ts.isJsxExpression(node)) return literalText(node.expression)
    if (ts.isConditionalExpression(node)) return [literalText(node.whenTrue), literalText(node.whenFalse)].filter(Boolean).join(' ') || null
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))
      return literalText(node.right)
    return null
  }
  // Style maps such as sonner's `classNames: { title: '…' }` hold CSS classes, not text.
  const inClassNames = (node: ts.Node) => {
    const owner = node.parent?.parent
    return !!owner && ts.isPropertyAssignment(owner) && /^classNames?$/.test(owner.name.getText(source))
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return
    if (ts.isJsxText(node) && hasText(node.text)) report(node, node.text)
    else if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(source))) {
      const text = literalText(node.initializer)
      if (text && hasText(text)) report(node, text)
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPS.has(node.name.getText(source).replace(/['"]/g, '')) && !inClassNames(node)) {
      const text = literalText(node.initializer)
      if (text && hasText(text)) report(node, text)
    } else if (ts.isCallExpression(node) && /^toast(\.\w+)?$/.test(node.expression.getText(source))) {
      const text = literalText(node.arguments[0])
      if (text && hasText(text)) report(node, text)
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[áéíóúñ¿¡«»]/i.test(node.text)) {
      report(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...new Set(found)]
}

describe('source', () => {
  it('shows no text that skips the catalogs', () => {
    expect(sources(root).flatMap(hardcodedText)).toEqual([])
  })
})
