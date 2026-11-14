import type { Messages } from './types'

export const en: Messages = {
  help: (defaultName) => `Installs your own copy of Orqevio on your Cloudflare account.

Usage:
  npx create-orqevio                   Install a new copy
  npx create-orqevio@latest update     Update your copy to the latest version (your data is kept)
  npx create-orqevio@latest recover    Get a new code to recover your access
  npx create-orqevio@latest uninstall  Delete your copy and everything in it

Options:
  --name <name>     Name of the copy (${defaultName} by default). It becomes part of its address.
  --account <id>    Cloudflare account to use, if you have several (or CLOUDFLARE_ACCOUNT_ID)
  --lang <code>     Language of these messages: en, es, fr, pt, it, de, nl or ja
  -h, --help        Show this help
  -v, --version     Show the version of Orqevio it installs

You need a Cloudflare account (the free plan is enough). The first time, your browser
opens so you can sign in.`,
  no: /^n/i,
  yesNo: '[Y/n]',
  extraArgument: (arg) => `Unexpected “${arg}”.`,
  unknownOption: (option) => `Unknown option “${option}”.`,
  missingValue: (option) => `“${option}” needs a value.`,
  unknownCommand: (command) => `Unknown command “${command}”.`,
  dryRunOnlyForDeployRepo: '--dry-run only works with deploy-repo.',
  unknownLanguage: (language, available) => `Unknown language “${language}”. Use one of: ${available}.`,
  needsNode: (minimum, current) => `You need Node ${minimum} or later (you have ${current}). Get it at https://nodejs.org.`,
  askName: (defaultName) => `Name of the copy (${defaultName}): `,
  badName: (name) => `“${name}” can’t be used as a name.`,
  nameRule: 'Use 1 to 50 lowercase letters, numbers or hyphens (no hyphen at the start or end).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: 'Installing', update: 'Updating', recover: 'Recovering access to', uninstall: 'Uninstalling' }[action]} the copy “${name}”`,
  accountUnreachable: 'Couldn’t check your Cloudflare account. Try again in a few minutes.',
  askUpdate: (name) => `You already have a copy called “${name}”. Update it to this version? Your data is kept.`,
  nothingChanged: 'Nothing has changed. For another copy, use another name: npx create-orqevio --name <name>',
  copyNotFound: (name, installCommand) => `There’s no copy called “${name}” in this account. To install it: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'Your Cloudflare account doesn’t have R2 enabled yet, and your copy needs it to store attachments.',
      `Enable it in the dashboard, under R2 → Overview: ${dashboardUrl}`,
      'The included usage is free (10 GB of storage a month), although Cloudflare may ask for a payment method.',
      `Then run again: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Sign in to Cloudflare in the browser that’s about to open. If it doesn’t open, open the link below yourself…\n',
  signInFailed: (command) => `Signing in to Cloudflare wasn’t completed. If the browser didn’t open, sign in on its own with ${command}, open the link it shows and run this command again.`,
  noAccessToAccount: (account, accounts) => `This session has no access to the account “${account}”. Available accounts:\n${accounts}`,
  noAccounts: 'Your Cloudflare session has no account available.',
  chooseAccountWithFlag: (accounts) => `You have several Cloudflare accounts. Choose one with --account <id>:\n${accounts}`,
  severalAccounts: (accounts) => `You have several Cloudflare accounts:\n${accounts}`,
  whichAccount: (count) => `Which one should I use? (1-${count}): `,
  deployFailed: '\nThe deploy failed. Check Wrangler’s message above; you can run the command again without losing anything.',
  workerAddress: (name) => `the address of your Worker “${name}” (Cloudflare dashboard → Workers & Pages)`,
  updated: (version, address) => `\nYour copy is updated to Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Your copy of Orqevio is up and running.',
      '',
      `  Address      ${address}`,
      `  Setup code   ${setupCode}`,
      '',
      'Open it and enter the code and your name. Orqevio then gives you your access key:',
      'save it in your password manager, because it’s all you need to sign in.',
      'The code stops working as soon as you claim the copy.',
      '',
      'Later on:',
      `  ${updateCommand}    updates your copy (your data is kept)`,
      `  ${recoverCommand}   gives you a new code if you lose the key`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Can’t read wrangler.jsonc in this folder: ${detail}`,
  badRepoName: (name) => `The Worker name in wrangler.jsonc (“${name}”) can’t be used.`,
  setupCodeFailed: '\nThe code couldn’t be changed. Check Wrangler’s message above.',
  recovered: (setupCode) =>
    [
      '',
      `New setup code: ${setupCode}`,
      '',
      'Open your copy, choose “Lost your key?” and enter this code to get a new access key.',
      'Every session is signed out; your data and your vault don’t change.',
      'If someone else may have had the key, answer “Someone else may have it” to disconnect your agents too.',
    ].join('\n'),
  uninstallNeedsTerminal: 'To uninstall, you type the copy’s name to confirm: run this command in a terminal.',
  nothingToUninstall: (name) => `There’s no copy called “${name}” in this account, so there’s nothing to delete.`,
  uninstallWarning: (name, bucket) =>
    [
      `This deletes the copy “${name}” for good, with everything in it:`,
      '  · its Worker, with your workspaces, documents, vault and agents;',
      `  · its bucket “${bucket}”, with the attachments.`,
      'It can’t be undone. To keep your vault, export an encrypted copy from it first.',
      '',
    ].join('\n'),
  askUninstallName: (name) => `Type “${name}” to confirm: `,
  nothingDeleted: 'Nothing was deleted.',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `The bucket “${bucket}” still holds attachments, and Cloudflare only deletes empty buckets. Nothing was deleted.`,
      `Empty it in one of these two ways, then run ${retryCommand} again:`,
      '  · in your copy: Settings → Uninstall Orqevio, which also deletes the rest of its data;',
      `  · in the Cloudflare dashboard: R2 → ${bucket} → Settings → Empty Bucket.`,
    ].join('\n'),
  uninstallFailed: '\nThe uninstall didn’t finish. Check Wrangler’s message above; you can run the command again.',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `The copy “${name}” is uninstalled: its Worker and its bucket are gone from your Cloudflare account.`,
      `If you don’t use Wrangler for anything else, sign out with ${logoutCommand}.`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `The bucket “${bucket}” still holds attachments, and Cloudflare only deletes empty buckets.`,
      'The installer can have your copy delete them: it authorizes the copy from your Cloudflare account, with no need for your access key.',
      'Leave the answer blank to do it another way.',
    ].join('\n'),
  askAddress: (name) => `Address of your copy (for example https://${name}.<your-subdomain>.workers.dev): `,
  badAddress: (address) => `“${address}” isn’t an address: use the one you open in the browser.`,
  notOrqevio: (origin) => `There’s no copy of Orqevio answering at ${origin}.`,
  otherCopy: (origin, other, name) => `${origin} is the copy “${other}”, not “${name}”.`,
  copyUnreachable: (origin, detail) => `Couldn’t reach your copy at ${origin} (${detail}). Nothing was deleted.`,
  authorizingCopy: 'Authorizing your copy from your Cloudflare account and waiting for it to answer (a few seconds)…',
  notThisAccount: (origin, name) => `${origin} isn’t the copy “${name}” of this Cloudflare account: it didn’t receive the authorization. Nothing was deleted.`,
  copyTooOld: (updateCommand) => `Your copy is from an earlier version that can’t do this. Update it with ${updateCommand} and run this command again, or empty the bucket from the app or the dashboard.`,
  copyEmptied: 'Your copy deleted its data and its attachments.',
}
