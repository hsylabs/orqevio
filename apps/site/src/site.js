// Adds a "Copiar" button to every command. The pages work without it.
for (const block of document.querySelectorAll('.command')) {
  const code = block.querySelector('pre')
  if (!code || !navigator.clipboard) continue
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'copy'
  button.textContent = 'Copiar'
  button.setAttribute('aria-label', 'Copiar la orden')
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.innerText.replace(/^\$ /gm, '').trim())
      button.textContent = 'Copiado'
    } catch {
      button.textContent = 'No se pudo copiar'
    }
    setTimeout(() => {
      button.textContent = 'Copiar'
    }, 2000)
  })
  block.append(button)
}
