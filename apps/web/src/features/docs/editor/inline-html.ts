/**
 * CommonMark inline raw HTML: an open or closing tag, a comment, a processing instruction, a
 * declaration or CDATA. Markdown reads it before anything else in a line (markdown.ts keeps it as
 * it was; a formula never crosses it, math.ts).
 */
const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`
export const INLINE_HTML = new RegExp(
  String.raw`^(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)`,
)

/**
 * The start of what could still be raw HTML or an autolink once more text follows, such as
 * `<span title="…` or `<a@b`. math.ts reads a paragraph a part at a time and needs to know whether
 * the rest could matter. This may accept a start that ends up being neither, but it never rejects
 * one that could be.
 */
export const INLINE_HTML_START = new RegExp(
  String.raw`^<(?:[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*(?:\s+(?:[A-Za-z_:][\w.:-]*)?|\s*\/|(?:\s+[A-Za-z_:][\w.:-]*)?\s*=\s*(?:'[^']*|"[^"]*)?)?|\/(?:[A-Za-z][A-Za-z0-9-]*\s*)?|!(?:-(?:-[\s\S]*)?|\[[\s\S]*|[A-Za-z][^>]*)?|\?[\s\S]*|[A-Za-z][A-Za-z0-9+.-]{0,31}(?::[^\s<>]*)?|[\w.!#$%&'*+/=?^\x60{|}~-]*(?:@[A-Za-z0-9.-]*)?)$`,
)

/** A CommonMark autolink: `<https://…>` or `<a@b.c>`. */
export const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/
