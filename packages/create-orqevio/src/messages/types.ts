export type Action = 'install' | 'update' | 'recover'

/** Everything the installer says. Commands, URLs and names are passed in, never translated. */
export interface Messages {
  help(defaultName: string): string
  /** Answers that mean "no" to a yes/no question (the default is yes). */
  no: RegExp
  /** The hint after a yes/no question whose default is yes, such as "[Y/n]". */
  yesNo: string
  extraArgument(arg: string): string
  unknownOption(option: string): string
  missingValue(option: string): string
  unknownCommand(command: string): string
  dryRunOnlyForDeployRepo: string
  unknownLanguage(language: string, available: string): string
  needsNode(minimum: string, current: string): string
  askName(defaultName: string): string
  badName(name: string): string
  nameRule: string
  heading(action: Action, version: string, name: string): string
  accountUnreachable: string
  askUpdate(name: string): string
  nothingChanged: string
  copyNotFound(name: string, installCommand: string): string
  r2Disabled(dashboardUrl: string, retryCommand: string): string
  signInPrompt: string
  signInFailed(manualCommand: string): string
  noAccessToAccount(account: string, accounts: string): string
  noAccounts: string
  chooseAccountWithFlag(accounts: string): string
  severalAccounts(accounts: string): string
  whichAccount(count: number): string
  deployFailed: string
  workerAddress(name: string): string
  updated(version: string, address: string): string
  installed(details: { address: string; setupCode: string; updateCommand: string; recoverCommand: string }): string
  cannotReadRepoConfig(detail: string): string
  badRepoName(name: string): string
  setupCodeFailed: string
  recovered(setupCode: string): string
}
