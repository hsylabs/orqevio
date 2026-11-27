/** Scripts written without spaces between words, where a word can be anywhere in a run of text. */
export const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * Whether a query is worth searching while it is typed: two characters or more, or one in a
 * script without spaces, where a single character is often a word (猫, 本).
 */
export function searchable(query: string) {
  const text = query.trim()
  return [...text].length >= 2 || UNSPACED_SCRIPT.test(text)
}
