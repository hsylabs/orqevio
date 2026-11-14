import type { Messages } from './types'

export const nl: Messages = {
  help: (defaultName) => `Zet je eigen installatie van Orqevio op in je Cloudflare-account.

Gebruik:
  npx create-orqevio                   Een nieuwe installatie opzetten
  npx create-orqevio@latest update     Bijwerken naar de nieuwste versie (je gegevens blijven behouden)
  npx create-orqevio@latest recover    Een nieuwe code krijgen om je toegang te herstellen
  npx create-orqevio@latest uninstall  Je installatie met alles erin verwijderen

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
    `Orqevio ${version} · ${{ install: `Installatie ‘${name}’ opzetten`, update: `Installatie ‘${name}’ bijwerken`, recover: `Toegang tot installatie ‘${name}’ herstellen`, uninstall: `Installatie ‘${name}’ verwijderen` }[action]}`,
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
  signInPrompt: 'Log in bij Cloudflare in de browser die zo meteen opent. Opent hij niet, open dan zelf de link hieronder…\n',
  signInFailed: (command) => `Het inloggen bij Cloudflare is niet afgerond. Is de browser niet geopend, log dan apart in met ${command}, open de link die verschijnt en voer deze opdracht opnieuw uit.`,
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
  uninstallNeedsTerminal: 'Om te verwijderen typ je de naam van de installatie: voer deze opdracht uit in een terminal.',
  nothingToUninstall: (name) => `Er staat geen installatie met de naam ‘${name}’ in dit account, dus er is niets te verwijderen.`,
  uninstallWarning: (name, bucket) =>
    [
      `Hiermee verwijder je de installatie ‘${name}’ definitief, met alles erin:`,
      '  · de Worker, met je werkruimtes, documenten, kluis en agents;',
      `  · de bucket ‘${bucket}’, met de bijlagen.`,
      'Dit kan niet ongedaan worden gemaakt. Wil je je kluis bewaren, exporteer daar dan eerst een versleutelde kopie van.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Typ ‘${name}’ om te bevestigen: `,
  nothingDeleted: 'Er is niets verwijderd.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `De bucket ‘${bucket}’ bevat nog bijlagen, en Cloudflare verwijdert alleen lege buckets. Er is niets verwijderd.`,
      `Maak hem op een van deze twee manieren leeg en voer daarna ${retryCommand} opnieuw uit:`,
      '  · in je installatie: Instellingen → Orqevio verwijderen, waarmee ook de rest van de gegevens verdwijnt;',
      `  · in het Cloudflare-dashboard: R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nHet verwijderen is niet afgerond. Bekijk de melding van Wrangler hierboven; je kunt de opdracht opnieuw uitvoeren.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `De installatie ‘${name}’ is verwijderd: de Worker en de bucket staan niet meer in je Cloudflare-account.`,
      `Gebruik je Wrangler verder nergens voor, meld je dan af met ${logoutCommand}.`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `De bucket ‘${bucket}’ bevat nog bijlagen, en Cloudflare verwijdert alleen lege buckets.`,
      'Het installatieprogramma kan met de toegangssleutel inloggen op je installatie en die haar gegevens laten verwijderen, zoals Instellingen → Orqevio verwijderen doet.',
      'Laat het antwoord leeg als je het liever anders doet.',
    ].join('\n'),
  askAddress: (name) => `Adres van je installatie (bijvoorbeeld https://${name}.<je-subdomein>.workers.dev): `,
  askAccessKey: 'Toegangssleutel van de installatie (wordt niet getoond terwijl je typt): ',
  badAddress: (address) => `‘${address}’ is geen adres: gebruik het adres dat je in de browser opent.`,
  notOrqevio: (origin) => `Op ${origin} reageert geen Orqevio-installatie.`,
  otherCopy: (origin, other, name) => `${origin} is de installatie ‘${other}’, niet ‘${name}’.`,
  wrongAccessKey: 'Die toegangssleutel is niet geldig.',
  copyUnreachable: (origin, detail) => `Je installatie op ${origin} is niet bereikbaar (${detail}). Er is niets verwijderd.`,
  copyEmptied: 'Je installatie heeft haar gegevens en bijlagen verwijderd.',
}
