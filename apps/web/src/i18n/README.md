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
- **French**: *vous*. Quotes « » with a narrow no-break space inside (« texte »), and a narrow
  no-break space before ; : ! ? as French typography requires.
- **Portuguese** (`pt`): Brazilian Portuguese, *você*. Quotes “ ”.
- **Italian**: informal *tu*. Quotes « ».
- **German**: informal *du*, as most modern apps. Quotes „ “.
- **Dutch**: informal *je*/*jij*. Quotes ‘ ’ for short names, “ ” for longer text.
- **Japanese**: polite です/ます form, no spaces between words, full-width punctuation (、。),
  quotes 「 」. Keep product and protocol names (Orqevio, MCP, OAuth, Markdown) in Latin script.
- Keep product words consistent:

| English | es | fr | it | pt | de | nl | ja |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workspace | espacio | espace | spazio | espaço | Arbeitsbereich | werkruimte | ワークスペース |
| project | proyecto | projet | progetto | projeto | Projekt | project | プロジェクト |
| board | tablero | tableau | bacheca | quadro | Board | bord | ボード |
| column | columna | colonne | colonna | coluna | Spalte | kolom | 列 |
| card | tarjeta | carte | scheda | cartão | Karte | kaart | カード |
| label | etiqueta | étiquette | etichetta | etiqueta | Label | label | ラベル |
| checklist | checklist | checklist | checklist | checklist | Checkliste | checklist | チェックリスト |
| page · document | página · documento | page · document | pagina · documento | página · documento | Seite · Dokument | pagina · document | ページ · ドキュメント |
| vault | bóveda | coffre-fort | cassaforte | cofre | Tresor | kluis | 保管庫 |
| master password | contraseña maestra | mot de passe principal | password principale | senha mestra | Master-Passwort | hoofdwachtwoord | マスターパスワード |
| recovery key | clave de recuperación | clé de récupération | chiave di recupero | chave de recuperação | Wiederherstellungsschlüssel | herstelsleutel | 回復キー |
| access key | clave de acceso | clé d’accès | chiave di accesso | chave de acesso | Zugangsschlüssel | toegangssleutel | アクセスキー |
| setup code | código de configuración | code de configuration | codice di configurazione | código de configuração | Einrichtungscode | installatiecode | セットアップコード |
| copy (an installation) | copia | copie | copia | cópia | Instanz | installatie | このOrqevio |
| login (vault item) | credencial | identifiant | login | login | Login | login | ログイン |
| export (vault file) | copia cifrada | export | esportazione | exportação | Export | export | エクスポート |
| agent · token | agente · token | agent · jeton | agente · token | agente · token | Agent · Token | agent · token | エージェント · トークン |
| archive · restore | archivar · restaurar | archiver · restaurer | archiviare · ripristinare | arquivar · restaurar | archivieren · wiederherstellen | archiveren · herstellen | アーカイブ · 復元 |
| Settings | Ajustes | Paramètres | Impostazioni | Configurações | Einstellungen | Instellingen | 設定 |

Every language except English and Spanish was translated with care but without a native
speaker yet; reviews by native speakers are welcome.
