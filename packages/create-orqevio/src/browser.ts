import { spawn } from 'node:child_process'

/**
 * Opens a link in the default browser on Windows through Explorer. Wrangler opens it
 * with an encoded PowerShell command (`-ExecutionPolicy Bypass -EncodedCommand …`),
 * which antivirus programs such as Norton block as suspicious: the browser never
 * opens and the sign-in times out. Explorer hands the link to the default browser
 * without any of that. Best effort: the link is printed too.
 */
export function openOnWindows(url: string) {
  try {
    const child = spawn('explorer.exe', [url], { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The link is on screen: the person can open it themselves.
  }
}
