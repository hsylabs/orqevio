// Adds a copy button to every command, in the page's language. The pages work without it.
const say = document.body.dataset
for (const block of document.querySelectorAll('.command')) {
  const code = block.querySelector('pre')
  if (!code || !navigator.clipboard) continue
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'copy'
  button.textContent = say.copy
  button.setAttribute('aria-label', say.copyLabel)
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.innerText.replace(/^\$ /gm, '').trim())
      button.textContent = say.copied
    } catch {
      button.textContent = say.copyFailed
    }
    setTimeout(() => {
      button.textContent = say.copy
    }, 2000)
  })
  block.append(button)
}
