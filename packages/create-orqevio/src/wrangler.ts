import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Wrangler's own entry script, run with this Node binary so it works the same on every OS. */
export function wranglerScript() {
  // Lets the tests stand a fake in for Wrangler.
  const override = process.env.CREATE_ORQEVIO_WRANGLER
  if (override) return override
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('wrangler/package.json')
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: Record<string, string> }
  return path.join(path.dirname(manifest), bin.wrangler!)
}

export interface WranglerRun {
  code: number
  /** Captured stdout and stderr (empty unless `capture` was set). */
  stdout: string
  stderr: string
}

export interface WranglerOptions {
  env?: Record<string, string>
  /** Capture the output instead of showing it (the terminal stays attached otherwise, for sign-in and prompts). */
  capture?: boolean
  /** Written to Wrangler's stdin, for commands that read a secret. */
  input?: string
  /**
   * Shows Wrangler's output as it comes, like the attached terminal would, and also
   * hands it here (used to read the sign-in link).
   */
  onOutput?: (text: string) => void
  /**
   * Where Wrangler runs. Never the user's current folder, so a wrangler.toml or
   * .env there cannot change what is deployed or which account is used.
   */
  cwd?: string
}

export function runWrangler(args: string[], options: WranglerOptions = {}): Promise<WranglerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerScript(), ...args], {
      cwd: options.cwd ?? tmpdir(),
      // Wrangler's anonymous telemetry stays off unless the user turned it on themselves.
      env: { WRANGLER_SEND_METRICS: 'false', ...process.env, ...options.env },
      stdio: [options.input !== undefined ? 'pipe' : 'inherit', options.capture || options.onOutput ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      if (options.onOutput) {
        process.stdout.write(chunk)
        options.onOutput(String(chunk))
      } else stdout += chunk
    })
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    if (options.input !== undefined) child.stdin!.end(options.input)
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** URLs from the "deploy" entries Wrangler writes to WRANGLER_OUTPUT_FILE_PATH (one JSON object per line). */
export function deployedUrls(outputFile: string): string[] {
  let text = ''
  try {
    text = readFileSync(outputFile, 'utf8')
  } catch {
    return []
  }
  const urls: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as { type?: string; targets?: unknown }
      if (entry.type === 'deploy' && Array.isArray(entry.targets)) urls.push(...entry.targets.filter((t): t is string => typeof t === 'string'))
    } catch {
      // Not a JSON line: ignore it.
    }
  }
  return urls
}
