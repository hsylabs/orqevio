const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {keys.map((k) => (
        <kbd key={k} className="kbd">
          {k === 'mod' ? modKey : k}
        </kbd>
      ))}
    </span>
  )
}
