import './style.css'

// gleiches Theme wie auf der Hauptseite (localStorage bzw. System), inkl. Toggle
let t: string | null = null
try { t = localStorage.getItem('theme') } catch { /* ignore */ }
if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = t

const btn = document.querySelector<HTMLButtonElement>('#theme')
if (btn) {
  btn.textContent = t === 'dark' ? '☀' : '☾'
  btn.addEventListener('click', () => {
    const nt = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = nt
    try { localStorage.setItem('theme', nt) } catch { /* ignore */ }
    btn.textContent = nt === 'dark' ? '☀' : '☾'
  })
}
