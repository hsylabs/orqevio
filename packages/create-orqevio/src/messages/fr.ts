import type { Messages } from './types'

// Terminal output: regular spaces before : ; ? ! and inside « », since terminals render
// narrow no-break spaces inconsistently.
export const fr: Messages = {
  help: (defaultName) => `Installe votre propre copie d’Orqevio sur votre compte Cloudflare.

Utilisation :
  npx create-orqevio                   Installe une nouvelle copie
  npx create-orqevio@latest update     Passe votre copie à la dernière version (vos données sont conservées)
  npx create-orqevio@latest recover    Génère un nouveau code pour récupérer votre accès
  npx create-orqevio@latest uninstall  Supprime votre copie et tout son contenu

Options :
  --name <nom>      Nom de la copie (${defaultName} par défaut). Il fait partie de son adresse.
  --account <id>    Compte Cloudflare à utiliser, si vous en avez plusieurs (ou CLOUDFLARE_ACCOUNT_ID)
  --lang <code>     Langue de ces messages : en, es, fr, pt, it, de, nl ou ja
  -h, --help        Affiche cette aide
  -v, --version     Affiche la version d’Orqevio installée

Il vous faut un compte Cloudflare (l’offre gratuite suffit). La première fois, votre
navigateur s’ouvre pour que vous puissiez vous connecter.`,
  no: /^n/i,
  yesNo: '[O/n]',
  extraArgument: (arg) => `Argument inattendu : « ${arg} ».`,
  unknownOption: (option) => `Option inconnue : « ${option} ».`,
  missingValue: (option) => `L’option « ${option} » attend une valeur.`,
  unknownCommand: (command) => `Commande inconnue : « ${command} ».`,
  dryRunOnlyForDeployRepo: '--dry-run ne fonctionne qu’avec deploy-repo.',
  unknownLanguage: (language, available) => `Langue inconnue : « ${language} ». Utilisez l’une de celles-ci : ${available}.`,
  needsNode: (minimum, current) => `Il vous faut Node ${minimum} ou une version plus récente (vous avez la ${current}). Téléchargez-le sur https://nodejs.org.`,
  askName: (defaultName) => `Nom de la copie (${defaultName}) : `,
  badName: (name) => `« ${name} » ne peut pas servir de nom.`,
  nameRule: 'Utilisez de 1 à 50 lettres minuscules, chiffres ou tirets (sans tiret au début ni à la fin).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: 'Installation de la copie', update: 'Mise à jour de la copie', recover: 'Récupération de l’accès à la copie', uninstall: 'Désinstallation de la copie' }[action]} « ${name} »`,
  accountUnreachable: 'Impossible de vérifier votre compte Cloudflare. Réessayez dans quelques minutes.',
  askUpdate: (name) => `Vous avez déjà une copie nommée « ${name} ». La mettre à jour vers cette version ? Vos données sont conservées.`,
  nothingChanged: 'Rien n’a été modifié. Pour une autre copie, choisissez un autre nom : npx create-orqevio --name <nom>',
  copyNotFound: (name, installCommand) => `Ce compte n’a aucune copie nommée « ${name} ». Pour l’installer : ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'R2 n’est pas encore activé sur votre compte Cloudflare, et votre copie en a besoin pour stocker les pièces jointes.',
      `Activez-le dans le tableau de bord, sous R2 → Overview : ${dashboardUrl}`,
      'L’utilisation incluse est gratuite (10 Go de stockage par mois), même si Cloudflare peut vous demander un moyen de paiement.',
      `Relancez ensuite : ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Connectez-vous à Cloudflare dans le navigateur qui va s’ouvrir. S’il ne s’ouvre pas, ouvrez vous-même le lien affiché ci-dessous…\n',
  signInFailed: (command) => `La connexion à Cloudflare n’a pas abouti. Si le navigateur ne s’est pas ouvert, connectez-vous séparément avec ${command}, ouvrez le lien affiché, puis relancez cette commande.`,
  noAccessToAccount: (account, accounts) => `Cette session n’a pas accès au compte « ${account} ». Comptes disponibles :\n${accounts}`,
  noAccounts: 'Votre session Cloudflare n’a accès à aucun compte.',
  chooseAccountWithFlag: (accounts) => `Vous avez plusieurs comptes Cloudflare. Choisissez-en un avec --account <id> :\n${accounts}`,
  severalAccounts: (accounts) => `Vous avez plusieurs comptes Cloudflare :\n${accounts}`,
  whichAccount: (count) => `Lequel dois-je utiliser ? (1-${count}) : `,
  deployFailed: '\nLe déploiement a échoué. Lisez le message de Wrangler ci-dessus ; vous pouvez relancer la commande sans rien perdre.',
  workerAddress: (name) => `l’adresse de votre Worker « ${name} » (tableau de bord Cloudflare → Workers et Pages)`,
  updated: (version, address) => `\nVotre copie est passée à Orqevio ${version} : ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Votre copie d’Orqevio est en ligne.',
      '',
      `  Adresse                ${address}`,
      `  Code de configuration  ${setupCode}`,
      '',
      'Ouvrez-la et saisissez le code et votre nom pour recevoir votre clé d’accès.',
      'Enregistrez-la dans votre gestionnaire de mots de passe : elle suffit pour vous connecter.',
      'Le code cesse de fonctionner dès que vous prenez possession de la copie.',
      '',
      'Plus tard :',
      `  ${updateCommand}    met à jour votre copie (vos données sont conservées)`,
      `  ${recoverCommand}   vous donne un nouveau code si vous perdez la clé`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Impossible de lire wrangler.jsonc dans ce dossier : ${detail}`,
  badRepoName: (name) => `Le nom du Worker dans wrangler.jsonc (« ${name} ») n’est pas utilisable.`,
  setupCodeFailed: '\nImpossible de modifier le code. Lisez le message de Wrangler ci-dessus.',
  recovered: (setupCode) =>
    [
      '',
      `Nouveau code de configuration : ${setupCode}`,
      '',
      'Ouvrez votre copie, choisissez « Clé perdue ? » et saisissez ce code pour obtenir',
      'une nouvelle clé d’accès. Toutes les sessions seront déconnectées ; vos données',
      'et votre coffre-fort ne changent pas.',
      'Si quelqu’un d’autre a pu avoir la clé, répondez « Quelqu’un d’autre l’a peut-être » pour déconnecter aussi vos agents.',
    ].join('\n'),
  uninstallNeedsTerminal: 'Pour désinstaller, vous devez saisir le nom de la copie : lancez cette commande dans un terminal.',
  nothingToUninstall: (name) => `Ce compte n’a aucune copie nommée « ${name} » : il n’y a rien à supprimer.`,
  uninstallWarning: (name, bucket) =>
    [
      `Ceci supprime définitivement la copie « ${name} » et tout son contenu :`,
      '  · son Worker, avec vos espaces, documents, coffre-fort et agents ;',
      `  · son bucket « ${bucket} », avec les pièces jointes.`,
      'C’est irréversible. Pour conserver votre coffre-fort, exportez-en d’abord une copie chiffrée.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Saisissez « ${name} » pour confirmer : `,
  nothingDeleted: 'Rien n’a été supprimé.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `Le bucket « ${bucket} » contient encore des pièces jointes, et Cloudflare ne supprime que les buckets vides. Rien n’a été supprimé.`,
      `Videz-le de l’une de ces deux façons, puis relancez ${retryCommand} :`,
      '  · dans votre copie : Paramètres → Désinstaller Orqevio, qui supprime aussi le reste de ses données ;',
      `  · dans le tableau de bord Cloudflare : R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nLa désinstallation n’est pas allée au bout. Lisez le message de Wrangler ci-dessus ; vous pouvez relancer la commande.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `La copie « ${name} » est désinstallée : son Worker et son bucket ont disparu de votre compte Cloudflare.`,
      `Si vous n’utilisez Wrangler pour rien d’autre, déconnectez-vous avec ${logoutCommand}.`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `Le bucket « ${bucket} » contient encore des pièces jointes, et Cloudflare ne supprime que les buckets vides.`,
      'L’installateur peut se connecter à votre copie avec sa clé d’accès et lui demander de supprimer ses données, comme le fait Paramètres → Désinstaller Orqevio.',
      'Laissez la réponse vide pour procéder autrement.',
    ].join('\n'),
  askAddress: (name) => `Adresse de votre copie (par exemple https://${name}.<votre-sous-domaine>.workers.dev) : `,
  askAccessKey: 'Clé d’accès de la copie (elle ne s’affiche pas pendant la saisie) : ',
  badAddress: (address) => `« ${address} » n’est pas une adresse : utilisez celle que vous ouvrez dans le navigateur.`,
  notOrqevio: (origin) => `Aucune copie d’Orqevio ne répond à ${origin}.`,
  otherCopy: (origin, other, name) => `${origin} est la copie « ${other} », pas « ${name} ».`,
  wrongAccessKey: 'Cette clé d’accès n’est pas valide.',
  copyUnreachable: (origin, detail) => `Impossible de joindre votre copie à ${origin} (${detail}). Rien n’a été supprimé.`,
  copyEmptied: 'Votre copie a supprimé ses données et ses pièces jointes.',
}
