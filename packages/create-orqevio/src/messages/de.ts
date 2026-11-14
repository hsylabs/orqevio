import type { Messages } from './types'

export const de: Messages = {
  help: (defaultName) => `Installiert deine eigene Orqevio-Instanz in deinem Cloudflare-Konto.

Verwendung:
  npx create-orqevio                   Installiert eine neue Instanz
  npx create-orqevio@latest update     Aktualisiert deine Instanz auf die neueste Version (deine Daten bleiben erhalten)
  npx create-orqevio@latest recover    Erzeugt einen neuen Code, mit dem du deinen Zugang wiederherstellst
  npx create-orqevio@latest uninstall  Löscht deine Instanz mit allem, was darin ist

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
  unknownOption: (option) => `Unbekannte Option „${option}“.`,
  missingValue: (option) => `Die Option „${option}“ braucht einen Wert.`,
  unknownCommand: (command) => `Unbekannter Befehl „${command}“.`,
  dryRunOnlyForDeployRepo: '--dry-run funktioniert nur mit deploy-repo.',
  unknownLanguage: (language, available) => `Unbekannte Sprache „${language}“. Verfügbar sind: ${available}.`,
  needsNode: (minimum, current) => `Du brauchst Node ${minimum} oder neuer (du hast ${current}). Du bekommst es unter https://nodejs.org.`,
  askName: (defaultName) => `Name der Instanz (${defaultName}): `,
  badName: (name) => `„${name}“ kann nicht als Name verwendet werden.`,
  nameRule: 'Verwende 1 bis 50 Kleinbuchstaben, Ziffern oder Bindestriche (kein Bindestrich am Anfang oder Ende).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: `Instanz „${name}“ wird installiert`, update: `Instanz „${name}“ wird aktualisiert`, recover: `Zugang zur Instanz „${name}“ wird wiederhergestellt`, uninstall: `Instanz „${name}“ wird deinstalliert` }[action]}`,
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
  signInPrompt: 'Melde dich in dem Browserfenster, das sich gleich öffnet, bei Cloudflare an. Falls es sich nicht öffnet, öffne den Link unten selbst…\n',
  signInFailed: (command) => `Die Anmeldung bei Cloudflare wurde nicht abgeschlossen. Falls sich der Browser nicht geöffnet hat, melde dich separat mit ${command} an, öffne den angezeigten Link und führe diesen Befehl erneut aus.`,
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
      'Falls jemand anderes den Schlüssel gehabt haben könnte, antworte „Jemand anderes könnte ihn haben“, um auch deine Agenten zu trennen.',
    ].join('\n'),
  uninstallNeedsTerminal: 'Zum Deinstallieren gibst du den Namen der Instanz ein: Führe diesen Befehl in einem Terminal aus.',
  nothingToUninstall: (name) => `In diesem Konto gibt es keine Instanz namens „${name}“, also gibt es nichts zu löschen.`,
  uninstallWarning: (name, bucket) =>
    [
      `Damit wird die Instanz „${name}“ endgültig gelöscht, mit allem, was darin ist:`,
      '  · ihr Worker, mit deinen Arbeitsbereichen, Dokumenten, deinem Tresor und deinen Agenten;',
      `  · ihr Bucket „${bucket}“, mit den Anhängen.`,
      'Das lässt sich nicht rückgängig machen. Wenn du deinen Tresor behalten willst, exportiere vorher eine verschlüsselte Kopie daraus.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Gib „${name}“ ein, um zu bestätigen: `,
  nothingDeleted: 'Es wurde nichts gelöscht.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `Der Bucket „${bucket}“ enthält noch Anhänge, und Cloudflare löscht nur leere Buckets. Es wurde nichts gelöscht.`,
      `Leere ihn auf eine dieser beiden Arten und führe dann ${retryCommand} noch einmal aus:`,
      '  · in deiner Instanz: Einstellungen → Orqevio deinstallieren, was auch die übrigen Daten löscht;',
      `  · im Cloudflare-Dashboard: R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nDie Deinstallation wurde nicht abgeschlossen. Sieh dir die Meldung von Wrangler oben an; du kannst den Befehl noch einmal ausführen.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `Die Instanz „${name}“ ist deinstalliert: Ihr Worker und ihr Bucket sind aus deinem Cloudflare-Konto entfernt.`,
      `Wenn du Wrangler sonst nicht nutzt, melde dich mit ${logoutCommand} ab.`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `Der Bucket „${bucket}“ enthält noch Anhänge, und Cloudflare löscht nur leere Buckets.`,
      'Der Installer kann deine Instanz die Anhänge löschen lassen: Er autorisiert sie über dein Cloudflare-Konto, ohne deinen Zugangsschlüssel.',
      'Lass die Antwort leer, wenn du es anders machen willst.',
    ].join('\n'),
  askAddress: (name) => `Adresse deiner Instanz (zum Beispiel https://${name}.<deine-subdomain>.workers.dev): `,
  badAddress: (address) => `„${address}“ ist keine Adresse: Nimm die, die du im Browser öffnest.`,
  notOrqevio: (origin) => `Unter ${origin} antwortet keine Orqevio-Instanz.`,
  otherCopy: (origin, other, name) => `${origin} ist die Instanz „${other}“, nicht „${name}“.`,
  copyUnreachable: (origin, detail) => `Deine Instanz unter ${origin} war nicht erreichbar (${detail}). Es wurde nichts gelöscht.`,
  authorizingCopy: 'Deine Instanz wird über dein Cloudflare-Konto autorisiert; warte auf ihre Antwort (ein paar Sekunden) …',
  notThisAccount: (origin, name) => `${origin} ist nicht die Instanz „${name}“ dieses Cloudflare-Kontos: Sie hat die Autorisierung nicht erhalten. Es wurde nichts gelöscht.`,
  copyTooOld: (updateCommand) => `Deine Instanz hat eine ältere Version, die das noch nicht kann. Aktualisiere sie mit ${updateCommand} und führe diesen Befehl noch einmal aus, oder leere den Bucket in der App oder im Dashboard.`,
  copyEmptied: 'Deine Instanz hat ihre Daten und Anhänge gelöscht.',
}
