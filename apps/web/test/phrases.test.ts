import { Parser, jaModel } from 'budoux'
import { describe, expect, it } from 'vitest'
import { splitPhrases } from '../src/components/Phrases'

const parser = new Parser(jaModel)
const budoux = (text: string) => parser.parse(text)
/** BudouX as it splits these, to check what is joined again whatever its model does. */
const given = (phrases: string[]) => () => phrases

describe('a Japanese title split into phrases', () => {
  it('is split where BudouX splits it, every character kept', () => {
    const title = '来週の打ち合わせまでに見積書を三社から取り寄せて比較する'
    expect(splitPhrases(title, budoux)).toEqual(['来週の', '打ち合わせまでに', '見積書を', '三社から', '取り寄せて', '比較する'])
    for (const text of ['引っ越し 2026年11月 第2週のまとめ 📦', 'GitHubとSlackの通知を整理する', '❤\ufe0f家族👨\u200d👩\u200d👧の予定を共有する', 'ユーザーへ送信するメールの文面']) {
      expect(splitPhrases(text, budoux).join(''), text).toBe(text)
    }
  })

  it('never breaks a number or a word of a spaced script', () => {
    expect(splitPhrases('会議 2026年11月21日', given(['会議 202', '6年11月21日']))).toEqual(['会議 2026年11月21日'])
    expect(splitPhrases('比較GitHubする', given(['比較G', 'itHubする']))).toEqual(['比較GitHubする'])
    // Between a spaced script and Japanese, or a space, it still breaks.
    expect(splitPhrases('Slackの通知', given(['Slackの', '通知']))).toEqual(['Slackの', '通知'])
    expect(splitPhrases('v2 の計画', given(['v2 ', 'の計画']))).toEqual(['v2 ', 'の計画'])
  })

  it('never breaks a character drawn from several code points', () => {
    expect(splitPhrases('引❤\ufe0fっ越しの', given(['引❤', '\ufe0fっ越しの']))).toEqual(['引❤\ufe0fっ越しの'])
    // Before the family it may break; inside it, never.
    expect(splitPhrases('まと👨\u200d👩\u200d👧めた', given(['まと', '👨\u200d👩\u200d', '👧めた']))).toEqual(['まと', '👨\u200d👩\u200d👧めた'])
    expect(splitPhrases('手👍🏽です', given(['手👍', '🏽です']))).toEqual(['手👍🏽です'])
  })
})
