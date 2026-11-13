import type { Messages } from './types'

export const de: Messages = {
  help: (defaultName) => `Installiert deine eigene Orqevio-Instanz in deinem Cloudflare-Konto.

Verwendung:
  npx create-orqevio                   Installiert eine neue Instanz
  npx create-orqevio@latest update     Aktualisiert deine Instanz auf die neueste Version (deine Daten bleiben erhalten)
  npx create-orqevio@latest recover    Erzeugt einen neuen Code, mit dem du deinen Zugang wiederherstellst

Optionen:
  --name <name>     Name der Instanz (standardmäßig ${defaultName}). Er wird Teil ihrer Adresse.
  --account <id>    Zu verwendendes Cloudflare-Konto, falls du mehrere hast (oder CLOUDFLARE_ACCOUNT_ID)
  --lang <code>     Sprache dieser Meldungen: en, es, fr, pt, it, de, nl oder ja
  -h, --help        Zeigt diese Hilfe an
  -v, --version     Zeigt die Orqevio-Version an, die installiert wird

Du brauchst ein Cloudflare-Konto (der kostenlose Plan reicht aus). Beim ersten Mal öffnet
sich dein Browser, damit du dich anmelden kannst.`,
  no: /^n/i,
  yesNo: '[J/n]',
  extraArgument: (arg) => `Unerwartetes Argument „${arg}“.`,
  unknownCommand: (command) => `Unbekannter Befehl „${command}“.`,
  dryRunOnlyForDeployRepo: '--dry-run funktioniert nur mit deploy-repo.',
  unknownLanguage: (language, available) => `Unbekannte Sprache „${language}“. Verfügbar sind: ${available}.`,
  needsNode: (minimum, current) => `Du brauchst Node ${minimum} oder neuer (du hast ${current}). Du bekommst es unter https://nodejs.org.`,
  askName: (defaultName) => `Name der Instanz (${defaultName}): `,
  badName: (name) => `„${name}“ kann nicht als Name verwendet werden.`,
  nameRule: 'Verwende 1 bis 50 Kleinbuchstaben, Ziffern oder Bindestriche (kein Bindestrich am Anfang oder Ende).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: `Instanz „${name}“ wird installiert`, update: `Instanz „${name}“ wird aktualisiert`, recover: `Zugang zur Instanz „${name}“ wird wiederhergestellt` }[action]}`,
  accountUnreachable: 'Dein Cloudflare-Konto konnte nicht geprüft werden. Versuch es in ein paar Minuten noch einmal.',
  askUpdate: (name) => `Du hast bereits eine Instanz namens „${name}“. Auf diese Version aktualisieren? Deine Daten bleiben erhalten.`,
  nothingChanged: 'Es wurde nichts geändert. Für eine weitere Instanz nimm einen anderen Namen: npx create-orqevio --name <name>',
  copyNotFound: (name, installCommand) => `In diesem Konto gibt es keine Instanz namens „${name}“. So installierst du sie: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'In deinem Cloudflare-Konto ist R2 noch nicht aktiviert, und deine Instanz braucht es, um Anhänge zu speichern.',
      `Aktiviere es im Dashboard unter R2 → Overview: ${dashboardUrl}`,
      'Die enthaltene Nutzung ist kostenlos (10 GB Speicherplatz pro Monat), Cloudflare fragt aber eventuell nach einer Zahlungsmethode.',
      `Führe danach erneut aus: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Melde dich in dem Browserfenster, das sich gleich öffnet, bei Cloudflare an…\n',
  signInFailed: 'Die Anmeldung bei Cloudflare wurde nicht abgeschlossen.',
  noAccessToAccount: (account, accounts) => `Diese Sitzung hat keinen Zugriff auf das Konto „${account}“. Verfügbare Konten:\n${accounts}`,
  noAccounts: 'In deiner Cloudflare-Sitzung ist kein Konto verfügbar.',
  chooseAccountWithFlag: (accounts) => `Du hast mehrere Cloudflare-Konten. Wähle eines mit --account <id> aus:\n${accounts}`,
  severalAccounts: (accounts) => `Du hast mehrere Cloudflare-Konten:\n${accounts}`,
  whichAccount: (count) => `Welches soll ich verwenden? (1-${count}): `,
  deployFailed: '\nDie Bereitstellung ist fehlgeschlagen. Sieh dir die Meldung von Wrangler oben an; du kannst den Befehl erneut ausführen, ohne etwas zu verlieren.',
  workerAddress: (name) => `die Adresse deines Workers „${name}“ (Cloudflare-Dashboard → Workers & Pages)`,
  updated: (version, address) => `\nDeine Instanz läuft jetzt mit Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Deine Orqevio-Instanz ist startklar.',
      '',
      `  Adresse           ${address}`,
      `  Einrichtungscode  ${setupCode}`,
      '',
      'Öffne sie und gib den Code und deinen Namen ein. Orqevio gibt dir dann deinen',
      'Zugangsschlüssel. Speichere ihn in deinem Passwort-Manager, denn mehr brauchst du zum',
      'Anmelden nicht. Der Code funktioniert nicht mehr, sobald du die Instanz eingerichtet hast.',
      '',
      'Für später:',
      `  ${updateCommand}    aktualisiert deine Instanz (deine Daten bleiben erhalten)`,
      `  ${recoverCommand}   gibt dir einen neuen Code, falls du den Schlüssel verlierst`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Die Datei wrangler.jsonc in diesem Ordner kann nicht gelesen werden: ${detail}`,
  badRepoName: (name) => `Der Worker-Name in wrangler.jsonc („${name}“) kann nicht verwendet werden.`,
  setupCodeFailed: '\nDer Code konnte nicht geändert werden. Sieh dir die Meldung von Wrangler oben an.',
  recovered: (setupCode) =>
    [
      '',
      `Neuer Einrichtungscode: ${setupCode}`,
      '',
      'Öffne deine Instanz, wähle „Schlüssel verloren?“ und gib diesen Code ein, um einen neuen',
      'Zugangsschlüssel zu bekommen. Alle Sitzungen werden abgemeldet; deine Daten und dein',
      'Tresor bleiben unverändert.',
    ].join('\n'),
}
