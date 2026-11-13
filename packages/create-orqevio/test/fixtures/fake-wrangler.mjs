// Stands in for Wrangler in the installer tests: records every call and
// answers like Wrangler would, driven by a small state file.
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const statePath = process.env.FAKE_WRANGLER_STATE
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const save = () => writeFileSync(statePath, JSON.stringify(state))
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const record = { args, cwd: process.cwd(), metrics: process.env.WRANGLER_SEND_METRICS ?? null, account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null }
const secretsFile = flag('--secrets-file')
if (secretsFile) record.secrets = { content: readFileSync(secretsFile, 'utf8'), mode: statSync(secretsFile).mode & 0o777 }
const config = flag('--config')
if (config) record.config = JSON.parse(readFileSync(config, 'utf8'))
if (!process.stdin.isTTY && args[0] === 'secret') record.stdin = readFileSync(0, 'utf8')
appendFileSync(process.env.FAKE_WRANGLER_LOG, `${JSON.stringify(record)}\n`)

const [command, sub] = args
const accounts = state.accounts ?? [{ id: 'acc-1', name: 'Ana' }]
if (command === 'whoami') {
  process.stdout.write(`${JSON.stringify(state.loggedIn ? { loggedIn: true, accounts } : { loggedIn: false })}\n`)
  process.exit(state.loggedIn ? 0 : 1)
}
// Like Wrangler: with several accounts and no CLOUDFLARE_ACCOUNT_ID, account commands
// can only ask interactively, which they cannot do with captured output.
if (command !== 'login' && accounts.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  process.stderr.write('✘ [ERROR] More than one account available but unable to select one in non-interactive mode.\n')
  process.exit(1)
}
if (command === 'login') {
  state.loggedIn = state.loginWorks !== false
  save()
  process.exit(state.loggedIn ? 0 : 1)
}
if (command === 'deployments' && sub === 'list') {
  if (state.accountError) {
    process.stderr.write('✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]\n')
    process.exit(1)
  }
  if (!state.exists) {
    process.stderr.write('✘ [ERROR] This Worker does not exist on your account. [code: 10007]\n')
    process.exit(1)
  }
  process.stdout.write('[]\n')
  process.exit(0)
}
if (command === 'deploy') {
  if (state.deployFails) process.exit(1)
  const name = JSON.parse(readFileSync(config, 'utf8')).name
  const output = process.env.WRANGLER_OUTPUT_FILE_PATH
  if (output) {
    appendFileSync(output, `${JSON.stringify({ type: 'wrangler-session', version: 1 })}\n`)
    appendFileSync(output, `${JSON.stringify({ type: 'deploy', version: 1, worker_name: name, targets: [`https://${name}.ana.workers.dev`] })}\n`)
  }
  state.exists = true
  save()
  process.exit(0)
}
if (command === 'r2' && sub === 'bucket' && args[2] === 'list') {
  if (state.r2Disabled) {
    process.stderr.write('✘ [ERROR] A request to the Cloudflare API (/accounts/acc-1/r2/buckets) failed. Please enable R2 through the Cloudflare Dashboard. [code: 10042]\n')
    process.exit(1)
  }
  process.stdout.write('[]\n')
  process.exit(0)
}
if (command === 'secret' && sub === 'put') process.exit(0)
process.exit(3)
