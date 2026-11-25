/**
 * CommonMark inline raw HTML: an open or closing tag, a comment, a processing instruction, a
 * declaration or CDATA. Markdown reads it before anything else in a line (markdown.ts keeps it as
 * it was; a formula never crosses it, math.ts).
 */
const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`
export const INLINE_HTML = new RegExp(
  String.raw`^(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)`,
)

/** A CommonMark autolink: `<https://…>` or `<a@b.c>`. */
export const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/
