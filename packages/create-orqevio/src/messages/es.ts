import type { Messages } from './types'

export const es: Messages = {
  help: (defaultName) => `Instala tu propia copia de Orqevio en tu cuenta de Cloudflare.

Uso:
  npx create-orqevio                   Instala una copia nueva
  npx create-orqevio@latest update     Actualiza tu copia a la última versión (tus datos se conservan)
  npx create-orqevio@latest recover    Genera un código nuevo para recuperar el acceso
  npx create-orqevio@latest uninstall  Borra tu copia y todo lo que contiene

Opciones:
  --name <nombre>   Nombre de la copia (por defecto, ${defaultName}). Forma parte de su dirección.
  --account <id>    Cuenta de Cloudflare que usar, si tienes varias (o CLOUDFLARE_ACCOUNT_ID)
  --lang <código>   Idioma de estos mensajes: en, es, fr, pt, it, de, nl o ja
  -h, --help        Muestra esta ayuda
  -v, --version     Muestra la versión de Orqevio que se instala

Necesitas una cuenta de Cloudflare (el plan gratuito basta). La primera vez se abrirá el
navegador para que inicies sesión.`,
  no: /^n/i,
  yesNo: '[S/n]',
  extraArgument: (arg) => `Sobra «${arg}».`,
  unknownOption: (option) => `No conozco la opción «${option}».`,
  missingValue: (option) => `«${option}» necesita un valor.`,
  unknownCommand: (command) => `No conozco la orden «${command}».`,
  dryRunOnlyForDeployRepo: '--dry-run solo vale con deploy-repo.',
  unknownLanguage: (language, available) => `No conozco el idioma «${language}». Usa uno de estos: ${available}.`,
  needsNode: (minimum, current) => `Necesitas Node ${minimum} o superior (tienes ${current}). Descárgalo en https://nodejs.org.`,
  askName: (defaultName) => `Nombre de la copia (${defaultName}): `,
  badName: (name) => `«${name}» no vale como nombre.`,
  nameRule: 'Usa de 1 a 50 letras minúsculas, números o guiones (sin guion al principio ni al final).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: 'instalar la copia', update: 'actualizar la copia', recover: 'recuperar el acceso a la copia', uninstall: 'desinstalar la copia' }[action]} «${name}»`,
  accountUnreachable: 'No he podido consultar tu cuenta de Cloudflare. Vuelve a intentarlo en unos minutos.',
  askUpdate: (name) => `Ya tienes una copia llamada «${name}». ¿La actualizo a esta versión? Tus datos se conservan.`,
  nothingChanged: 'No he cambiado nada. Para otra copia, usa otro nombre: npx create-orqevio --name <nombre>',
  copyNotFound: (name, installCommand) => `No encuentro una copia llamada «${name}» en esta cuenta. Para instalarla: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'Tu cuenta de Cloudflare todavía no tiene R2 activado, y tu copia lo necesita para guardar los adjuntos.',
      `Actívalo en el panel, en R2 → Overview: ${dashboardUrl}`,
      'El uso incluido es gratis (10 GB de almacenamiento al mes), aunque Cloudflare puede pedirte un método de pago.',
      `Después, repite: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Inicia sesión en Cloudflare en el navegador que se va a abrir. Si no se abre, abre tú el enlace que aparece abajo…\n',
  signInFailed: (command) => `No se ha completado el inicio de sesión en Cloudflare. Si el navegador no se ha abierto, inicia sesión aparte con ${command}, abre el enlace que muestra y vuelve a ejecutar esta orden.`,
  noAccessToAccount: (account, accounts) => `Esta sesión no tiene acceso a la cuenta «${account}». Cuentas disponibles:\n${accounts}`,
  noAccounts: 'Tu sesión de Cloudflare no tiene ninguna cuenta disponible.',
  chooseAccountWithFlag: (accounts) => `Tienes varias cuentas de Cloudflare. Elige una con --account <id>:\n${accounts}`,
  severalAccounts: (accounts) => `Tienes varias cuentas de Cloudflare:\n${accounts}`,
  whichAccount: (count) => `¿Cuál uso? (1-${count}): `,
  deployFailed: '\nNo se ha podido desplegar. Revisa el mensaje de Wrangler de arriba; puedes repetir la orden sin perder nada.',
  workerAddress: (name) => `la dirección de tu Worker «${name}» (panel de Cloudflare → Workers y Pages)`,
  updated: (version, address) => `\nTu copia está actualizada a Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Tu copia de Orqevio está en marcha.',
      '',
      `  Dirección                ${address}`,
      `  Código de configuración  ${setupCode}`,
      '',
      'Ábrela, escribe el código y tu nombre. Orqevio te dará entonces tu clave de acceso:',
      'guárdala en tu gestor de contraseñas, porque es lo único que necesitas para entrar.',
      'El código deja de servir en cuanto reclames la copia.',
      '',
      'Más adelante:',
      `  ${updateCommand}    actualiza tu copia (tus datos se conservan)`,
      `  ${recoverCommand}   te da un código nuevo si pierdes la clave`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `No puedo leer wrangler.jsonc en esta carpeta: ${detail}`,
  badRepoName: (name) => `El nombre del Worker en wrangler.jsonc («${name}») no vale.`,
  setupCodeFailed: '\nNo se ha podido cambiar el código. Revisa el mensaje de Wrangler de arriba.',
  recovered: (setupCode) =>
    [
      '',
      `Nuevo código de configuración: ${setupCode}`,
      '',
      'Abre tu copia, pulsa «¿Has perdido la clave?» y escribe este código para recibir una',
      'clave de acceso nueva. Se cerrarán todas las sesiones; tus datos y tu bóveda no cambian.',
      'Si alguien más pudo tener la clave, responde «Puede que alguien la tenga» para desconectar también a tus agentes.',
    ].join('\n'),
  uninstallNeedsTerminal: 'Para desinstalar tienes que escribir el nombre de la copia: ejecuta este comando en una terminal.',
  nothingToUninstall: (name) => `No hay ninguna copia llamada «${name}» en esta cuenta: no hay nada que borrar.`,
  uninstallWarning: (name, bucket) =>
    [
      `Esto borra para siempre la copia «${name}» con todo lo que contiene:`,
      '  · su Worker, con tus espacios, documentos, bóveda y agentes;',
      `  · su bucket «${bucket}», con los adjuntos.`,
      'No se puede deshacer. Si quieres conservar la bóveda, exporta antes una copia cifrada desde ella.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Escribe «${name}» para confirmar: `,
  nothingDeleted: 'No se ha borrado nada.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `El bucket «${bucket}» todavía guarda adjuntos, y Cloudflare solo borra buckets vacíos. No se ha borrado nada.`,
      `Vacíalo de una de estas dos formas y vuelve a ejecutar ${retryCommand}:`,
      '  · en tu copia: Ajustes → Desinstalar Orqevio, que además borra el resto de sus datos;',
      `  · en el panel de Cloudflare: R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nLa desinstalación no ha terminado. Revisa el mensaje de Wrangler de arriba; puedes volver a ejecutar el comando.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `La copia «${name}» está desinstalada: su Worker y su bucket ya no están en tu cuenta de Cloudflare.`,
      `Si no usas Wrangler para nada más, cierra la sesión con ${logoutCommand}.`,
    ].join('\n'),
}
