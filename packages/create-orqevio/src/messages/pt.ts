import type { Messages } from './types'

export const pt: Messages = {
  help: (defaultName) => `Instala sua própria cópia do Orqevio na sua conta da Cloudflare.

Uso:
  npx create-orqevio                   Instala uma nova cópia
  npx create-orqevio@latest update     Atualiza sua cópia para a versão mais recente (seus dados são mantidos)
  npx create-orqevio@latest recover    Gera um novo código para recuperar seu acesso

Opções:
  --name <nome>     Nome da cópia (${defaultName} por padrão). Ele passa a fazer parte do endereço.
  --account <id>    Conta da Cloudflare a usar, se você tiver várias (ou CLOUDFLARE_ACCOUNT_ID)
  --lang <código>   Idioma destas mensagens: en, es, fr, pt, it, de, nl ou ja
  -h, --help        Mostra esta ajuda
  -v, --version     Mostra a versão do Orqevio que será instalada

Você precisa de uma conta da Cloudflare (o plano gratuito basta). Na primeira vez, o
navegador abre para você fazer login.`,
  no: /^n/i,
  yesNo: '[S/n]',
  extraArgument: (arg) => `Argumento inesperado: “${arg}”.`,
  unknownOption: (option) => `Opção desconhecida: “${option}”.`,
  missingValue: (option) => `A opção “${option}” precisa de um valor.`,
  unknownCommand: (command) => `O comando “${command}” não existe.`,
  dryRunOnlyForDeployRepo: '--dry-run só funciona com deploy-repo.',
  unknownLanguage: (language, available) => `O idioma “${language}” não está disponível. Use um destes: ${available}.`,
  needsNode: (minimum, current) => `Você precisa do Node ${minimum} ou mais recente (você tem o ${current}). Baixe em https://nodejs.org.`,
  askName: (defaultName) => `Nome da cópia (${defaultName}): `,
  badName: (name) => `“${name}” não pode ser usado como nome.`,
  nameRule: 'Use de 1 a 50 letras minúsculas, números ou hifens (sem hífen no início nem no fim).',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: 'Instalando a cópia', update: 'Atualizando a cópia', recover: 'Recuperando o acesso à cópia' }[action]} “${name}”`,
  accountUnreachable: 'Não foi possível verificar sua conta da Cloudflare. Tente de novo em alguns minutos.',
  askUpdate: (name) => `Você já tem uma cópia chamada “${name}”. Quer atualizá-la para esta versão? Seus dados são mantidos.`,
  nothingChanged: 'Nada foi alterado. Para outra cópia, use outro nome: npx create-orqevio --name <nome>',
  copyNotFound: (name, installCommand) => `Não há nenhuma cópia chamada “${name}” nesta conta. Para instalá-la: ${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'Sua conta da Cloudflare ainda não tem o R2 ativado, e sua cópia precisa dele para guardar os anexos.',
      `Ative-o no painel, em R2 → Overview: ${dashboardUrl}`,
      'O uso incluído é gratuito (10 GB de armazenamento por mês), embora a Cloudflare possa pedir uma forma de pagamento.',
      `Depois, execute de novo: ${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'Faça login na Cloudflare no navegador que vai se abrir. Se ele não abrir, abra você mesmo o link que aparece abaixo…\n',
  signInFailed: (command) => `O login na Cloudflare não foi concluído. Se o navegador não abriu, faça login separadamente com ${command}, abra o link que ele mostrar e execute este comando de novo.`,
  noAccessToAccount: (account, accounts) => `Esta sessão não tem acesso à conta “${account}”. Contas disponíveis:\n${accounts}`,
  noAccounts: 'Sua sessão da Cloudflare não tem nenhuma conta disponível.',
  chooseAccountWithFlag: (accounts) => `Você tem várias contas da Cloudflare. Escolha uma com --account <id>:\n${accounts}`,
  severalAccounts: (accounts) => `Você tem várias contas da Cloudflare:\n${accounts}`,
  whichAccount: (count) => `Qual delas devo usar? (1-${count}): `,
  deployFailed: '\nO deploy falhou. Confira a mensagem do Wrangler acima; você pode executar o comando de novo sem perder nada.',
  workerAddress: (name) => `o endereço do seu Worker “${name}” (painel da Cloudflare → Workers & Pages)`,
  updated: (version, address) => `\nSua cópia foi atualizada para o Orqevio ${version}: ${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'Sua cópia do Orqevio já está no ar.',
      '',
      `  Endereço                ${address}`,
      `  Código de configuração  ${setupCode}`,
      '',
      'Abra-a e digite o código e seu nome. Em seguida, o Orqevio gera sua chave de acesso:',
      'guarde-a no seu gerenciador de senhas, porque ela é tudo de que você precisa para entrar.',
      'O código deixa de funcionar assim que você configurar a cópia.',
      '',
      'Mais tarde:',
      `  ${updateCommand}    atualiza sua cópia (seus dados são mantidos)`,
      `  ${recoverCommand}   gera um novo código se você perder a chave`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `Não foi possível ler o wrangler.jsonc nesta pasta: ${detail}`,
  badRepoName: (name) => `O nome do Worker no wrangler.jsonc (“${name}”) não pode ser usado.`,
  setupCodeFailed: '\nNão foi possível alterar o código. Confira a mensagem do Wrangler acima.',
  recovered: (setupCode) =>
    [
      '',
      `Novo código de configuração: ${setupCode}`,
      '',
      'Abra sua cópia, escolha “Perdeu sua chave?” e digite este código para receber uma nova',
      'chave de acesso. Todas as sessões são encerradas; seus dados e seu cofre não mudam.',
      'Se outra pessoa pode ter tido a chave, responda “Talvez outra pessoa a tenha” para desconectar também seus agentes.',
    ].join('\n'),
}
