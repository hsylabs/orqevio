import type { Messages } from './types'

export const it: Messages = {
  help: (defaultName) => `Installa la tua copia personale di Orqevio nel tuo account Cloudflare.

Uso:
  npx create-orqevio                   Installa una nuova copia
  npx create-orqevio@latest update     Aggiorna la tua copia all’ultima versione (senza perdere i dati)
  npx create-orqevio@latest recover    Genera un nuovo codice per recuperare l’accesso
  npx create-orqevio@latest uninstall  Elimina la tua copia e tutto ciò che contiene

Opzioni:
  --name <nome>     Nome della copia (predefinito: ${defaultName}). Diventa parte del suo indirizzo.
  --account <id>    Account Cloudflare da usare, se ne hai più di uno (o CLOUDFLARE_ACCOUNT_ID)
  --lang <codice>   Lingua di questi messaggi: en, es, fr, pt, it, de, nl o ja
  -h, --help        Mostra questo aiuto
  -v, --version     Mostra la versione di Orqevio che viene installata

Ti serve un account Cloudflare (basta il piano gratuito). La prima volta si apre il browser
per farti accedere.`,
  no: /^n/i,
  yesNo: '[S/n]',
  extraArgument: (arg) => `Argomento inatteso: «${arg}».`,
  unknownOption: (option) => `Opzione sconosciuta: «${option}».`,
  missingValue: (option) => `L’opzione «${option}» richiede un valore.`,
  unknownCommand: (command) => `Comando sconosciuto: «${command}».`,
  dryRunOnlyForDeployRepo: '--dry-run funziona solo con deploy-repo.',
  unknownLanguage: (language, available) => `Lingua sconosciuta: «${language}». Usa una di queste: ${available}.`,
  needsNode: (minimum, current) => `Ti serve Node ${minimum} o successivo (hai la ${current}). Scaricalo da https://nodejs.org.`,
  askName: (defaultName) => `Nome della copia (${defaultName}): `,
  badName: (name) => `«${name}» non si può usare come nome.`,
  nameRule: 'Usa da 1 a 50 lettere minuscole, numeri o trattini (senza trattino all’inizio o alla fine).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: 'Installazione della copia', update: 'Aggiornamento della copia', recover: 'Recupero dell’accesso alla copia', uninstall: 'Disinstallazione della copia' }[action]} «${name}»`,
  accountUnreachable: 'Non sono riuscito a controllare il tuo account Cloudflare. Riprova tra qualche minuto.',
  askUpdate: (name) => `Hai già una copia chiamata «${name}». Vuoi aggiornarla a questa versione? I tuoi dati vengono mantenuti.`,
  nothingChanged: 'Non ho cambiato nulla. Per un’altra copia, usa un altro nome: npx create-orqevio --name <nome>',
  copyNotFound: (name, installCommand) => `In questo account non c’è nessuna copia chiamata «${name}». Per installarla: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'Nel tuo account Cloudflare R2 non è ancora attivo, e alla tua copia serve per salvare gli allegati.',
      `Attivalo nella dashboard, in R2 → Overview: ${dashboardUrl}`,
      'L’utilizzo incluso è gratuito (10 GB di spazio al mese), anche se Cloudflare potrebbe chiederti un metodo di pagamento.',
      `Poi esegui di nuovo: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Accedi a Cloudflare nel browser che sta per aprirsi. Se non si apre, apri tu il link che compare qui sotto…\n',
  signInFailed: (command) => `L’accesso a Cloudflare non è stato completato. Se il browser non si è aperto, accedi a parte con ${command}, apri il link che mostra ed esegui di nuovo questo comando.`,
  noAccessToAccount: (account, accounts) => `Questa sessione non ha accesso all’account «${account}». Account disponibili:\n${accounts}`,
  noAccounts: 'La tua sessione Cloudflare non ha nessun account disponibile.',
  chooseAccountWithFlag: (accounts) => `Hai più account Cloudflare. Scegline uno con --account <id>:\n${accounts}`,
  severalAccounts: (accounts) => `Hai più account Cloudflare:\n${accounts}`,
  whichAccount: (count) => `Quale devo usare? (1-${count}): `,
  deployFailed: '\nIl deploy non è riuscito. Controlla il messaggio di Wrangler qui sopra; puoi eseguire di nuovo il comando senza perdere nulla.',
  workerAddress: (name) => `l’indirizzo del tuo Worker «${name}» (dashboard di Cloudflare → Workers e Pages)`,
  updated: (version, address) => `\nLa tua copia è stata aggiornata a Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'La tua copia di Orqevio è attiva e funzionante.',
      '',
      `  Indirizzo                 ${address}`,
      `  Codice di configurazione  ${setupCode}`,
      '',
      'Aprila e inserisci il codice e il tuo nome. Orqevio ti darà la tua chiave di accesso:',
      'salvala nel tuo gestore di password, perché è tutto ciò che ti serve per accedere.',
      'Il codice smette di funzionare non appena prendi possesso della copia.',
      '',
      'Più avanti:',
      `  ${updateCommand}    aggiorna la tua copia (senza perdere i dati)`,
      `  ${recoverCommand}   ti dà un nuovo codice se perdi la chiave`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Non riesco a leggere wrangler.jsonc in questa cartella: ${detail}`,
  badRepoName: (name) => `Il nome del Worker in wrangler.jsonc («${name}») non si può usare.`,
  setupCodeFailed: '\nNon è stato possibile cambiare il codice. Controlla il messaggio di Wrangler qui sopra.',
  recovered: (setupCode) =>
    [
      '',
      `Nuovo codice di configurazione: ${setupCode}`,
      '',
      'Apri la tua copia, scegli «Hai perso la chiave?» e inserisci questo codice per ricevere',
      'una nuova chiave di accesso. Tutte le sessioni verranno chiuse; i tuoi dati e la tua',
      'cassaforte non cambiano.',
      'Se qualcun altro potrebbe aver avuto la chiave, rispondi «Qualcun altro potrebbe averla» per disconnettere anche i tuoi agenti.',
    ].join('\n'),
  uninstallNeedsTerminal: 'Per disinstallare devi scrivere il nome della copia: esegui questo comando in un terminale.',
  nothingToUninstall: (name) => `In questo account non c’è nessuna copia chiamata «${name}»: non c’è niente da eliminare.`,
  uninstallWarning: (name, bucket) =>
    [
      `Questo elimina per sempre la copia «${name}» con tutto ciò che contiene:`,
      '  · il suo Worker, con i tuoi spazi, documenti, cassaforte e agenti;',
      `  · il suo bucket «${bucket}», con gli allegati.`,
      'Non si può annullare. Per conservare la cassaforte, esportane prima una copia cifrata.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Scrivi «${name}» per confermare: `,
  nothingDeleted: 'Non è stato eliminato niente.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `Il bucket «${bucket}» contiene ancora degli allegati, e Cloudflare elimina solo i bucket vuoti. Non è stato eliminato niente.`,
      `Svuotalo in uno di questi due modi, poi esegui di nuovo ${retryCommand}:`,
      '  · nella tua copia: Impostazioni → Disinstallare Orqevio, che elimina anche il resto dei suoi dati;',
      `  · nella dashboard di Cloudflare: R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nLa disinstallazione non è andata a buon fine. Controlla il messaggio di Wrangler qui sopra; puoi eseguire di nuovo il comando.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `La copia «${name}» è disinstallata: il suo Worker e il suo bucket non sono più nel tuo account Cloudflare.`,
      `Se non usi Wrangler per nient’altro, esci con ${logoutCommand}.`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `Il bucket «${bucket}» contiene ancora degli allegati, e Cloudflare elimina solo i bucket vuoti.`,
      'L’installer può chiedere alla tua copia di eliminarli: la autorizza dal tuo account Cloudflare, senza bisogno della tua chiave di accesso.',
      'Lascia la risposta vuota se preferisci farlo in un altro modo.',
    ].join('\n'),
  askAddress: (name) => `Indirizzo della tua copia (per esempio https://${name}.<tuo-sottodominio>.workers.dev): `,
  badAddress: (address) => `«${address}» non è un indirizzo: usa quello che apri nel browser.`,
  notOrqevio: (origin) => `Nessuna copia di Orqevio risponde a ${origin}.`,
  otherCopy: (origin, other, name) => `${origin} è la copia «${other}», non «${name}».`,
  copyUnreachable: (origin, detail) => `Non riesco a raggiungere la tua copia a ${origin} (${detail}). Non è stato eliminato niente.`,
  authorizingCopy: 'Autorizzo la tua copia dal tuo account Cloudflare e aspetto la sua risposta (qualche secondo)…',
  notThisAccount: (origin, name) => `${origin} non è la copia «${name}» di questo account Cloudflare: non ha ricevuto l’autorizzazione. Non è stato eliminato niente.`,
  copyTooOld: (updateCommand) => `La tua copia è di una versione precedente che non sa farlo. Aggiornala con ${updateCommand} ed esegui di nuovo questo comando, oppure svuota il bucket dall’app o dalla dashboard.`,
  copyEmptied: 'La tua copia ha eliminato i suoi dati e i suoi allegati.',
}
