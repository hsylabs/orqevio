import { useLayoutEffect, useRef } from 'react'

/**
 * Where the focus goes back to when a dialog, a sheet or the palette closes: what had it when it
 * opened, or, when that was an item of a menu (gone by then), the menu's button. Radix gives it
 * back only to a `Dialog.Trigger`, which the app does not use: without this it ends on the page
 * itself, and a keyboard or screen reader user has to find their place again.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<{ element: HTMLElement | null; menuButton: HTMLElement | null }>({ element: null, menuButton: null })
  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    const element = active instanceof HTMLElement && active !== document.body ? active : null
    const menu = element?.closest('[role="menu"]')
    const menuButton = menu?.id ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`) : null
    opener.current = { element, menuButton }
  }, [open])
  return (event: Event) => {
    const { element, menuButton } = opener.current
    const target = element?.isConnected ? element : menuButton?.isConnected ? menuButton : null
    if (!target) return
    event.preventDefault()
    target.focus()
  }
}
