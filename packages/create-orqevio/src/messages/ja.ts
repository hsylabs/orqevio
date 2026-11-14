import type { Messages } from './types'

// Japanese characters take two columns in a terminal: labels are padded so the values line up.
export const ja: Messages = {
  help: (defaultName) => `あなた専用のOrqevioを、お使いのCloudflareアカウントにインストールします。

使い方：
  npx create-orqevio                   新しいOrqevioをインストール
  npx create-orqevio@latest update     最新バージョンに更新（データはそのまま残ります）
  npx create-orqevio@latest recover    アクセスを回復するための新しいコードを発行
  npx create-orqevio@latest uninstall  Orqevioとその中身をすべて削除

オプション：
  --name <名前>     Orqevioの名前（既定は${defaultName}）。アドレスの一部になります。
  --account <id>    使用するCloudflareアカウント（複数ある場合。CLOUDFLARE_ACCOUNT_IDでも指定可）
  --lang <コード>   メッセージの言語：en、es、fr、pt、it、de、nl、ja
  -h, --help        このヘルプを表示
  -v, --version     インストールされるOrqevioのバージョンを表示

Cloudflareアカウントが必要です（無料プランで十分です）。初回はブラウザが開くので、
そこでログインしてください。`,
  // n, no, いいえ, and the full-width ｎ that a Japanese input method may type.
  no: /^(n|ｎ|いいえ)/i,
  yesNo: '[Y/n]',
  extraArgument: (arg) => `予期しない引数「${arg}」があります。`,
  unknownOption: (option) => `不明なオプション「${option}」です。`,
  missingValue: (option) => `オプション「${option}」には値が必要です。`,
  unknownCommand: (command) => `「${command}」は不明なコマンドです。`,
  dryRunOnlyForDeployRepo: '--dry-runはdeploy-repoでのみ使えます。',
  unknownLanguage: (language, available) => `「${language}」は不明な言語です。次のいずれかを指定してください：${available}。`,
  needsNode: (minimum, current) => `Node ${minimum}以降が必要です（現在は${current}）。https://nodejs.org から入手してください。`,
  askName: (defaultName) => `Orqevioの名前（${defaultName}）：`,
  badName: (name) => `「${name}」は名前として使えません。`,
  nameRule: '英小文字、数字、ハイフンを1〜50文字で指定してください（先頭と末尾にハイフンは使えません）。',
  heading: (action, version, name) =>
    `Orqevio ${version} · ${{ install: `「${name}」をインストール中`, update: `「${name}」を更新中`, recover: `「${name}」へのアクセスを回復中`, uninstall: `「${name}」をアンインストール中` }[action]}`,
  accountUnreachable: 'Cloudflareアカウントを確認できませんでした。数分後にもう一度お試しください。',
  askUpdate: (name) => `「${name}」という名前のOrqevioがすでにあります。このバージョンに更新しますか？データはそのまま残ります。`,
  nothingChanged: '何も変更していません。別のOrqevioをインストールするには、別の名前を指定してください：npx create-orqevio --name <名前>',
  copyNotFound: (name, installCommand) => `このアカウントに「${name}」という名前のOrqevioはありません。インストールするには：${installCommand}`,
  r2Disabled: (dashboardUrl, retryCommand) =>
    [
      'お使いのCloudflareアカウントでは、まだR2が有効になっていません。Orqevioは添付ファイルの保存にR2を使います。',
      `ダッシュボードの「R2 → Overview」で有効にしてください：${dashboardUrl}`,
      '無料枠（ストレージは月10 GBまで）なら料金はかかりませんが、Cloudflareから支払い方法の登録を求められることがあります。',
      `その後、もう一度実行してください：${retryCommand}`,
    ].join('\n'),
  signInPrompt: 'これから開くブラウザで、Cloudflareにログインしてください。開かない場合は、下に表示されるリンクを自分で開いてください…\n',
  signInFailed: (command) => `Cloudflareへのログインが完了しませんでした。ブラウザが開かなかった場合は、${command} で別途ログインし、表示されたリンクを開いてから、このコマンドをもう一度実行してください。`,
  noAccessToAccount: (account, accounts) => `このセッションでは、アカウント「${account}」にアクセスできません。利用できるアカウント：\n${accounts}`,
  noAccounts: 'このCloudflareセッションで利用できるアカウントがありません。',
  chooseAccountWithFlag: (accounts) => `Cloudflareアカウントが複数あります。--account <id>で1つ選んでください：\n${accounts}`,
  severalAccounts: (accounts) => `Cloudflareアカウントが複数あります：\n${accounts}`,
  whichAccount: (count) => `どのアカウントを使いますか？（1〜${count}）：`,
  deployFailed: '\nデプロイに失敗しました。上に表示されたWranglerのメッセージを確認してください。何も失われないので、コマンドはもう一度実行できます。',
  workerAddress: (name) => `Worker「${name}」のアドレス（Cloudflareダッシュボード → Workers & Pages）`,
  updated: (version, address) => `\nOrqevio ${version}への更新が完了しました：${address}`,
  installed: ({ address, setupCode, updateCommand, recoverCommand }) =>
    [
      '',
      'あなたのOrqevioが動き始めました。',
      '',
      `  アドレス            ${address}`,
      `  セットアップコード  ${setupCode}`,
      '',
      'アドレスを開いて、コードと名前を入力してください。Orqevioがアクセスキーを発行します。',
      'ログインに必要なのはこのキーだけなので、パスワードマネージャーに保存してください。',
      'セットアップが済むと、コードはすぐに使えなくなります。',
      '',
      '今後の操作：',
      `  ${updateCommand}    Orqevioを更新します（データはそのまま残ります）`,
      `  ${recoverCommand}   キーを紛失したときに、新しいコードを発行します`,
    ].join('\n'),
  cannotReadRepoConfig: (detail) => `このフォルダーのwrangler.jsoncを読み込めません：${detail}`,
  badRepoName: (name) => `wrangler.jsoncのWorker名（「${name}」）は使えません。`,
  setupCodeFailed: '\nコードを変更できませんでした。上に表示されたWranglerのメッセージを確認してください。',
  recovered: (setupCode) =>
    [
      '',
      `新しいセットアップコード：${setupCode}`,
      '',
      'Orqevioを開いて「キーを紛失した場合」を選び、このコードを入力してください。',
      '新しいアクセスキーが発行され、すべてのセッションはログアウトされます。',
      'データと保管庫はそのまま変わりません。',
      'ほかの人がキーを持っていた可能性がある場合は、「ほかの人が持っているかもしれない」を選ぶと、エージェントの接続も解除されます。',
    ].join('\n'),
  uninstallNeedsTerminal: 'アンインストールでは確認のためにOrqevioの名前を入力します。このコマンドはターミナルで実行してください。',
  nothingToUninstall: (name) => `このアカウントに「${name}」という名前のOrqevioはありません。削除するものはありません。`,
  uninstallWarning: (name, bucket) =>
    [
      `「${name}」とその中身をすべて完全に削除します：`,
      '  ・Worker（ワークスペース、ドキュメント、保管庫、エージェントを含む）',
      `  ・バケット「${bucket}」（添付ファイルを含む）`,
      '元に戻すことはできません。保管庫を残したい場合は、先に保管庫から暗号化されたエクスポートを作成してください。',
      '',
    ].join('\n'),
  askUninstallName: (name) => `確認のため「${name}」と入力してください：`,
  nothingDeleted: '何も削除していません。',
  bucketNotEmpty: (bucket, retryCommand) =>
    [
      '',
      `バケット「${bucket}」にはまだ添付ファイルがあり、Cloudflareは空のバケットしか削除できません。何も削除していません。`,
      `次のいずれかの方法で空にしてから、もう一度 ${retryCommand} を実行してください：`,
      '  ・Orqevioで：設定 → Orqevioのアンインストール（残りのデータも削除されます）',
      `  ・Cloudflareのダッシュボードで：R2 → ${bucket} → Settings → Empty Bucket`,
    ].join('\n'),
  uninstallFailed: '\nアンインストールが完了しませんでした。上に表示されたWranglerのメッセージを確認してください。コマンドはもう一度実行できます。',
  uninstalled: (name, logoutCommand) =>
    [
      '',
      `「${name}」をアンインストールしました。WorkerとバケットはCloudflareアカウントから削除されました。`,
      `ほかにWranglerを使っていなければ、${logoutCommand} でログアウトしてください。`,
    ].join('\n'),
  emptyingThroughCopy: (bucket) =>
    [
      '',
      `バケット「${bucket}」にはまだ添付ファイルがあり、Cloudflareは空のバケットしか削除できません。`,
      'インストーラーがCloudflareアカウントからOrqevioに許可を与え、添付ファイルを削除させることができます。アクセスキーは不要です。',
      '別の方法で行う場合は、何も入力せずにEnterを押してください。',
    ].join('\n'),
  askAddress: (name) => `Orqevioのアドレス（例：https://${name}.<サブドメイン>.workers.dev）：`,
  badAddress: (address) => `「${address}」はアドレスではありません。ブラウザーで開いているアドレスを使ってください。`,
  notOrqevio: (origin) => `${origin}ではOrqevioが応答しません。`,
  otherCopy: (origin, other, name) => `${origin}は「${other}」で、「${name}」ではありません。`,
  copyUnreachable: (origin, detail) => `${origin}のOrqevioに接続できませんでした（${detail}）。何も削除していません。`,
  authorizingCopy: 'CloudflareアカウントからOrqevioに許可を与え、応答を待っています（数秒かかります）…',
  notThisAccount: (origin, name) => `${origin}はこのCloudflareアカウントの「${name}」ではありません（許可が届きませんでした）。何も削除していません。`,
  copyTooOld: (updateCommand) => `お使いのOrqevioは以前のバージョンのため、この操作に対応していません。${updateCommand}で更新してからもう一度このコマンドを実行するか、アプリまたはダッシュボードでバケットを空にしてください。`,
  copyEmptied: 'Orqevioがデータと添付ファイルを削除しました。',
}
