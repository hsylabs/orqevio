import type { Messages } from './types'

export const nl: Messages = {
  help: (defaultName) => `Zet je eigen installatie van Orqevio op in je Cloudflare-account.

Gebruik:
  npx create-orqevio                   Een nieuwe installatie opzetten
  npx create-orqevio@latest update     Bijwerken naar de nieuwste versie (je gegevens blijven behouden)
  npx create-orqevio@latest recover    Een nieuwe code krijgen om je toegang te herstellen

Opties:
  --name <naam>     Naam van de installatie (standaard ${defaultName}). Wordt onderdeel van het adres.
  --account <id>    Te gebruiken Cloudflare-account, als je er meerdere hebt (of CLOUDFLARE_ACCOUNT_ID)
  --lang <code>     Taal van deze berichten: en, es, fr, pt, it, de, nl of ja
  -h, --help        Deze hulp tonen
  -v, --version     De versie van Orqevio tonen die wordt geïnstalleerd

Je hebt een Cloudflare-account nodig (het gratis abonnement is genoeg). De eerste keer
opent je browser, zodat je kunt inloggen.`,
  no: /^n/i,
  yesNo: '[J/n]',
  extraArgument: (arg) => `Onverwacht argument ‘${arg}’.`,
  unknownOption: (option) => `Onbekende optie ‘${option}’.`,
  missingValue: (option) => `De optie ‘${option}’ heeft een waarde nodig.`,
  unknownCommand: (command) => `Onbekende opdracht ‘${command}’.`,
  dryRunOnlyForDeployRepo: '--dry-run werkt alleen met deploy-repo.',
  unknownLanguage: (language, available) => `Onbekende taal ‘${language}’. Kies een van deze: ${available}.`,
  needsNode: (minimum, current) => `Je hebt Node ${minimum} of nieuwer nodig (je gebruikt nu ${current}). Je vindt het op https://nodejs.org.`,
  askName: (defaultName) => `Naam van de installatie (${defaultName}): `,
  badName: (name) => `‘${name}’ kan niet als naam worden gebruikt.`,
  nameRule: 'Gebruik 1 tot 50 kleine letters, cijfers of koppeltekens (geen koppelteken aan het begin of eind).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: `Installatie ‘${name}’ opzetten`, update: `Installatie ‘${name}’ bijwerken`, recover: `Toegang tot installatie ‘${name}’ herstellen` }[action]}`,
  accountUnreachable: 'Je Cloudflare-account kon niet worden gecontroleerd. Probeer het over een paar minuten opnieuw.',
  askUpdate: (name) => `Je hebt al een installatie met de naam ‘${name}’. Bijwerken naar deze versie? Je gegevens blijven behouden.`,
  nothingChanged: 'Er is niets gewijzigd. Voor een extra installatie kies je een andere naam: npx create-orqevio --name <naam>',
  copyNotFound: (name, installCommand) => `Er staat geen installatie met de naam ‘${name}’ in dit account. Zo zet je die op: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'R2 is nog niet ingeschakeld in je Cloudflare-account, en je installatie heeft het nodig om bijlagen op te slaan.',
      `Schakel het in via het dashboard, onder R2 → Overview: ${dashboardUrl}`,
      'Het inbegrepen gebruik is gratis (10 GB opslag per maand), al kan Cloudflare om een betaalmethode vragen.',
      `Voer daarna opnieuw uit: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Log in bij Cloudflare in de browser die zo meteen opent…\n',
  signInFailed: 'Het inloggen bij Cloudflare is niet afgerond.',
  noAccessToAccount: (account, accounts) => `Deze sessie heeft geen toegang tot het account ‘${account}’. Beschikbare accounts:\n${accounts}`,
  noAccounts: 'Er is geen account beschikbaar in je Cloudflare-sessie.',
  chooseAccountWithFlag: (accounts) => `Je hebt meerdere Cloudflare-accounts. Kies er een met --account <id>:\n${accounts}`,
  severalAccounts: (accounts) => `Je hebt meerdere Cloudflare-accounts:\n${accounts}`,
  whichAccount: (count) => `Welke wil je gebruiken? (1-${count}): `,
  deployFailed: '\nHet uitrollen is mislukt. Bekijk de melding van Wrangler hierboven; je kunt de opdracht opnieuw uitvoeren zonder iets te verliezen.',
  workerAddress: (name) => `het adres van je Worker ‘${name}’ (Cloudflare-dashboard → Workers & Pages)`,
  updated: (version, address) => `\nJe installatie is bijgewerkt naar Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Je installatie van Orqevio draait.',
      '',
      `  Adres              ${address}`,
      `  Installatiecode    ${setupCode}`,
      '',
      'Open het adres en voer de code en je naam in. Orqevio geeft je dan je toegangssleutel:',
      'bewaar die in je wachtwoordmanager, want meer heb je niet nodig om in te loggen.',
      'De code werkt niet meer zodra je de installatie hebt ingesteld.',
      '',
      'Voor later:',
      `  ${updateCommand}    werkt je installatie bij (je gegevens blijven behouden)`,
      `  ${recoverCommand}   geeft je een nieuwe code als je de sleutel kwijt bent`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Kan wrangler.jsonc in deze map niet lezen: ${detail}`,
  badRepoName: (name) => `De naam van de Worker in wrangler.jsonc (‘${name}’) kan niet worden gebruikt.`,
  setupCodeFailed: '\nDe code kon niet worden gewijzigd. Bekijk de melding van Wrangler hierboven.',
  recovered: (setupCode) =>
    [
      '',
      `Nieuwe installatiecode: ${setupCode}`,
      '',
      'Open je installatie, kies ‘Sleutel kwijt?’ en voer deze code in. Je krijgt dan een nieuwe',
      'toegangssleutel. Alle sessies worden uitgelogd; je gegevens en je kluis blijven ongewijzigd.',
      'Kan iemand anders de sleutel hebben gehad, antwoord dan ‘Iemand anders heeft hem misschien’ om ook je agents los te koppelen.',
    ].join('\n'),
}
