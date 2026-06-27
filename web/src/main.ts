import './style.css'

interface Station {
  id: string
  name: string
  temp_c: number
  obs_utc: string
}

interface Snapshot {
  generated_utc: string
  station_count: number
  stations: Station[]
}

interface PeriodTop {
  key: string
  station_count: number
  stations: Station[]
}

interface Tops {
  generated_utc: string
  periods: Record<PeriodKey, PeriodTop>
}

type PeriodKey = 'day' | 'week' | 'month' | 'year'
type View = 'now' | PeriodKey
type SortDir = 'hot' | 'cold'

const PERIOD_LABEL: Record<PeriodKey, string> = {
  day: 'heute',
  week: 'diese Woche',
  month: 'diesen Monat',
  year: 'dieses Jahr',
}

const DATA = import.meta.env.BASE_URL + 'data/'

// Anzeige in Berlin-Zeit (Browser rechnet DST korrekt). Gespeichert bleibt UTC.
const fTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})
const fFull = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', weekday: 'short',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el
}

const rowsEl = $<HTMLTableSectionElement>('#rows')
const metaEl = $<HTMLElement>('#meta')
const filterEl = $<HTMLInputElement>('#filter')
const sortEl = $<HTMLButtonElement>('#sortdir')
const reloadEl = $<HTMLButtonElement>('#reload')
const periodsEl = $<HTMLElement>('#periods')
const thTimeEl = $<HTMLElement>('#th-time')

let latest: Snapshot | null = null
let tops: Tops | null = null
let view: View = 'now'
let sortDir: SortDir = 'hot'
let filter = ''

function tempClass(t: number): string {
  if (t >= 35) return 'tx-scorch'
  if (t >= 30) return 'tx-hot'
  if (t >= 25) return 'tx-warm'
  if (t >= 15) return 'tx-mild'
  if (t >= 5) return 'tx-cool'
  return 'tx-cold'
}

function fmtTime(iso: string): string {
  if (!iso) return '—'
  // Backfill aus dem Tagesarchiv: nur Datum, keine Uhrzeit -> "DD.MM."
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return `${m[3]}.${m[2]}.`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : fTime.format(d).replace(',', ' ')
}

function fmtFull(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${fFull.format(d)} Uhr`
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Liefert Stationsliste + Metazeile für die aktive Ansicht. */
function currentData(): { stations: Station[]; meta: string } | null {
  if (view === 'now') {
    if (!latest) return null
    return {
      stations: latest.stations,
      meta: `Snapshot <strong>${fmtFull(latest.generated_utc)}</strong> · ${latest.station_count} Stationen`,
    }
  }
  if (!tops) return null
  const p = tops.periods[view]
  if (!p) return null
  return {
    stations: p.stations,
    meta: `Höchstwerte <strong>${PERIOD_LABEL[view]}</strong> · ${p.key} · ${p.station_count} Stationen`,
  }
}

function render(): void {
  thTimeEl.textContent = view === 'now' ? 'Messzeit' : 'Höchstwert am'

  const data = currentData()
  if (!data) {
    rowsEl.innerHTML = ''
    metaEl.innerHTML =
      '<span class="err">Für diesen Zeitraum liegen noch keine Daten vor.</span>'
    return
  }
  metaEl.innerHTML = data.meta

  const q = filter.trim().toLowerCase()
  const list = data.stations
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => (sortDir === 'hot' ? b.temp_c - a.temp_c : a.temp_c - b.temp_c))

  if (list.length === 0) {
    rowsEl.innerHTML =
      `<tr><td colspan="5" class="empty">Keine Station passt zu „${esc(filter)}".</td></tr>`
    return
  }

  const temps = data.stations.map((s) => s.temp_c)
  const min = Math.min(...temps)
  const span = Math.max(1, Math.max(...temps) - min)

  rowsEl.innerHTML = list
    .map((s, i) => {
      const rank = i + 1
      const cls = tempClass(s.temp_c)
      const pct = (((s.temp_c - min) / span) * 100).toFixed(1)
      const top = sortDir === 'hot' && rank <= 3 ? ' is-top' : ''
      return (
        `<tr class="${cls}${top}">` +
        `<td class="rank">${rank}</td>` +
        `<td class="name">${esc(s.name)}</td>` +
        `<td class="bar"><span class="fill" style="width:${pct}%"></span></td>` +
        `<td class="temp">${s.temp_c.toFixed(1)}°</td>` +
        `<td class="time">${fmtTime(s.obs_utc)}</td>` +
        `</tr>`
      )
    })
    .join('')
}

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(DATA + file, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    console.error(`konnte ${file} nicht laden`, err)
    return null
  }
}

async function load(): Promise<void> {
  ;[latest, tops] = await Promise.all([
    fetchJson<Snapshot>('latest.json'),
    fetchJson<Tops>('tops.json'),
  ])
  if (!latest && !tops) {
    rowsEl.innerHTML = ''
    metaEl.innerHTML =
      '<span class="err">Keine Daten gefunden — bitte zuerst ' +
      '<code>./temp-leaderboard.sh</code> ausführen.</span>'
    return
  }
  render()
}

periodsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]')
  if (!btn) return
  view = btn.dataset.period as View
  for (const b of periodsEl.querySelectorAll('button')) b.classList.toggle('active', b === btn)
  render()
})

filterEl.addEventListener('input', () => {
  filter = filterEl.value
  render()
})

sortEl.addEventListener('click', () => {
  sortDir = sortDir === 'hot' ? 'cold' : 'hot'
  sortEl.innerHTML = sortDir === 'hot' ? '&#8595; Heißeste zuerst' : '&#8593; Kälteste zuerst'
  render()
})

reloadEl.addEventListener('click', () => void load())

void load()
