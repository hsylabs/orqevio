// Applies the saved theme before first paint to avoid a flash of the wrong palette.
try {
  var theme = localStorage.getItem('orqevio.theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch (e) {}
