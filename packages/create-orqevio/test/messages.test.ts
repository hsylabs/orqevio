import { describe, expect, it } from 'vitest'
import { CATALOGS, LANGUAGES, detectLanguage } from '../src/messages'
import { en } from '../src/messages/en'

describe('installer languages', () => {
  it('follow the terminal, as gettext reads it, then the system, then English', () => {
    expect(detectLanguage({ LANG: 'es_ES.UTF-8' }, 'en-US')).toBe('es')
    expect(detectLanguage({ LANGUAGE: 'zh_CN:ja_JP', LANG: 'es_ES.UTF-8' }, 'en-US')).toBe('ja')
    expect(detectLanguage({ LC_ALL: 'C', LANG: 'pt_BR.UTF-8' }, 'en-US')).toBe('pt')
    expect(detectLanguage({}, 'de-DE')).toBe('de')
    expect(detectLanguage({ LANG: 'zh_TW.UTF-8' }, 'ko-KR')).toBe('en')
  })

  it.each(LANGUAGES)('%s: every message keeps the commands, codes and names it is given', (language) => {
    const m = CATALOGS[language]
    const installed = m.installed({ address: 'ADDRESS', setupCode: 'CODE', updateCommand: 'UPDATE-CMD', recoverCommand: 'RECOVER-CMD' })
    for (const value of ['ADDRESS', 'CODE', 'UPDATE-CMD', 'RECOVER-CMD']) expect(installed).toContain(value)
    expect(m.help('DEFAULT')).toContain('DEFAULT')
    for (const command of ['npx create-orqevio', 'npx create-orqevio@latest update', 'npx create-orqevio@latest recover', 'npx create-orqevio@latest uninstall', '--name', '--account', '--lang'])
      expect(m.help('x')).toContain(command)
    for (const action of ['install', 'update', 'recover', 'uninstall'] as const) expect(m.heading(action, '9.9.9', 'NAME')).toMatch(/Orqevio 9\.9\.9.*NAME/)
    expect(m.nothingToUninstall('NAME')).toContain('NAME')
    expect(m.uninstallWarning('NAME', 'BUCKET')).toMatch(/NAME[\s\S]*BUCKET/)
    expect(m.askUninstallName('NAME')).toContain('NAME')
    expect(m.bucketNotEmpty('BUCKET', 'RETRY')).toMatch(/BUCKET[\s\S]*RETRY[\s\S]*BUCKET/)
    expect(m.uninstalled('NAME', 'LOGOUT')).toMatch(/NAME[\s\S]*LOGOUT/)
    expect(m.emptyingThroughCopy('BUCKET')).toContain('BUCKET')
    expect(m.askAddress('NAME')).toContain('https://NAME.')
    expect(m.otherCopy('ORIGIN', 'OTHER', 'NAME')).toMatch(/ORIGIN[\s\S]*OTHER[\s\S]*NAME/)
    expect(m.copyUnreachable('ORIGIN', 'DETAIL')).toMatch(/ORIGIN[\s\S]*DETAIL/)
    expect(m.notThisAccount('ORIGIN', 'NAME')).toMatch(/ORIGIN[\s\S]*NAME/)
    expect(m.copyTooOld('UPDATE-CMD')).toContain('UPDATE-CMD')
    for (const text of [m.badAddress('ADDRESS'), m.notOrqevio('ADDRESS')]) expect(text).toContain('ADDRESS')
    expect(m.r2Disabled('DASHBOARD', 'RETRY')).toMatch(/DASHBOARD[\s\S]*RETRY/)
    expect(m.recovered('CODE')).toContain('CODE')
    expect(m.heading('install', '9.9.9', 'NAME')).toMatch(/Orqevio 9\.9\.9.*NAME/)
    expect(m.copyNotFound('NAME', 'INSTALL-CMD')).toMatch(/NAME[\s\S]*INSTALL-CMD/)
    expect(m.whichAccount(3)).toContain('3')
    expect(m.unknownOption('--x')).toContain('--x')
    expect(m.missingValue('--x')).toContain('--x')
    expect(m.signInFailed('MANUAL-CMD')).toContain('MANUAL-CMD')
    expect(m.no.test('')).toBe(false)
  })

  it.each(LANGUAGES.filter((language) => language !== 'en'))('%s is translated', (language) => {
    expect(CATALOGS[language]).not.toBe(en)
    expect(CATALOGS[language].help('x')).not.toBe(en.help('x'))
  })
})
