# Translations

Orqevio speaks the languages in `LOCALES` (`packages/shared/src/locales.ts`). English is
the default, is always bundled and is the reference: every other catalog must have
exactly its keys. A language appears in the app as soon as its folder exists here.

```
src/i18n/locales/<language>/<namespace>.json
```

Namespaces follow the areas of the app: `common` (shared words, dates, colours),
`errors`, `activity`, `shell`, `auth`, `home`, `projects`, `boards`, `docs`, `vault`,
`agents`, `oauth` and `settings`.

`pnpm --filter @orqevio/web test` checks that each catalog has every key of English,
with the same `{{variables}}` and `<tags>`, in every plural form its language needs,
and that no text in `src` skips the catalogs.

## In code

```tsx
const { t } = useTranslation('vault')              // keys of vault.json
const { t } = useTranslation(['vault', 'common'])  // also t('common:actions.cancel')
t('items.count', { count: items.length })
```

- Outside components, `import { t } from 'i18next'` and write the namespace:
  `t('vault:locked')`. Never call `t` at module level: build lists of options inside
  the component, or keep keys in the list and translate when rendering.
- Keys are camelCase, grouped by screen or component (`gate.unlock.title`), and say
  what the text is for, not what it says.
- Whole sentences only. Never join translated fragments or put words around a
  variable in code: word order changes between languages.
- Rich text uses `<Trans>` with named tags, for example
  `"Press <kbd>{{key}}</kbd> to search"` and `components={{ kbd: <Kbd /> }}`.
- Dates, numbers, sizes and lists go through `lib/format.ts` (`relativeTime`,
  `shortDate`, `longDate`, `bytes`, `formatNumber`, `formatList`), which use `Intl`
  in the current language. A component that shows them calls `useTranslation()`,
  so it renders again when the language changes.

## Plurals

i18next picks the form with `Intl.PluralRules`. Give every form the language has:

| Language | Forms |
| --- | --- |
| en, de, nl | `_one`, `_other` |
| es, fr, it, pt | `_one`, `_many`, `_other` (`_many` is for exact millions; usually the same text as `_other`) |
| ja | `_other` |

A missing form shows the key instead of the text.

## Style

- **English**: American spelling, sentence case, short and friendly, second person.
  Contractions are fine. Typographic apostrophes and quotes: ’ “ ”.
- **Spanish**: Spain, informal *tú*. Quotes « ».
- Keep product words consistent:

| English | Español |
| --- | --- |
| workspace | espacio |
| project · board · column · card · label · checklist | proyecto · tablero · columna · tarjeta · etiqueta · checklist |
| page, document | página, documento |
| vault · master password · recovery key | bóveda · contraseña maestra · clave de recuperación |
| access key · setup code · copy (of Orqevio) | clave de acceso · código de configuración · copia |
| agent · token | agente · token |
| archive · restore | archivar · restaurar |
| Settings | Ajustes |
