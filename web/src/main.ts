import './style.css'
import { FUNFACTS } from './funfacts'

/* ---------- Typen ---------- */
interface Station { id: string; name: string; temp_c: number; obs_utc: string }
interface Snapshot { generated_utc: string; station_count: number; stations: Station[] }
interface TopStation {
  id: string; name: string
  max_c: number; max_obs_utc: string
  min_c: number; min_obs_utc: string
}
interface PeriodTop { key: string; station_count: number; stations: TopStation[] }
interface Tops { generated_utc: string; periods: Record<PeriodKey, PeriodTop> }
interface Stats {
  generated_utc: string
  hottest?: { name: string; temp_c: number }
  coldest?: { name: string; temp_c: number }
  spread_c?: number; station_count?: number; records_today?: number
  top_riser?: { name: string; delta_c: number }
  top_faller?: { name: string; delta_c: number }
}
type Coords = Record<string, { name: string; lat: number; lon: number }>
interface Germany { rings: [number, number][][] }
interface Series { dates: string[]; stations: Record<string, { max: (number | null)[]; min: (number | null)[] }> }

type PeriodKey = 'day' | 'week' | 'month' | 'year'
type View = 'now' | PeriodKey
type Metric = 'max' | 'min'
type SortDir = 'hot' | 'cold'
interface Item { id: string; name: string; value: number; obs: string }

const PERIOD_LABEL: Record<PeriodKey, string> = {
  day: 'heute', week: 'diese Woche', month: 'diesen Monat', year: 'dieses Jahr',
}
const BASE = import.meta.env.BASE_URL

/* ---------- Zeit-Format (Berlin) ---------- */
const fTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})
const fFull = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', weekday: 'short',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
function fmtTime(iso: string): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)        // Backfill: nur Datum
  if (m) return `${m[3]}.${m[2]}.`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : fTime.format(d).replace(',', ' ')
}
function fmtFull(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${fFull.format(d)} Uhr`
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('de-DE',
    { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
function tempClass(t: number): string {
  if (t >= 35) return 'tx-scorch'
  if (t >= 30) return 'tx-hot'
  if (t >= 25) return 'tx-warm'
  if (t >= 15) return 'tx-mild'
  if (t >= 5) return 'tx-cool'
  return 'tx-cold'
}

/* ---------- DOM ---------- */
const $ = <T extends Element>(s: string): T => {
  const el = document.querySelector<T>(s); if (!el) throw new Error('missing ' + s); return el
}
const rowsEl = $<HTMLTableSectionElement>('#rows')
const tableEl = $<HTMLTableElement>('#boardtable')
const metaEl = $<HTMLElement>('#meta')
const statsEl = $<HTMLElement>('#stats')
const filterEl = $<HTMLInputElement>('#filter')
const sortEl = $<HTMLButtonElement>('#sortdir')
const reloadEl = $<HTMLButtonElement>('#reload')
const periodsEl = $<HTMLElement>('#periods')
const metricEl = $<HTMLElement>('#metric')
const viewEl = $<HTMLElement>('#viewtoggle')
const thTimeEl = $<HTMLElement>('#th-time')
const legendEl = $<HTMLElement>('#legend')
const mapWrap = $<HTMLElement>('#mapwrap')
const themeEl = $<HTMLButtonElement>('#theme')
const detailEl = $<HTMLElement>('#detail')
const detailBody = $<HTMLElement>('#detail-body')

/* ---------- Zustand ---------- */
let latest: Snapshot | null = null
let tops: Tops | null = null
let stats: Stats | null = null
let coords: Coords = {}
let germany: Germany | null = null
let series: Series | null = null
let seriesLoading = false

let view: View = 'now'
let metric: Metric = 'max'
let sortDir: SortDir = 'hot'
let mapView = false
let filter = ''

/* ---------- Daten ---------- */
async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(BASE + file, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return (await res.json()) as T
  } catch (e) { console.error('konnte', file, 'nicht laden', e); return null }
}

async function loadAll(): Promise<void> {
  const [la, to, st, co, ge] = await Promise.all([
    fetchJson<Snapshot>('data/latest.json'),
    fetchJson<Tops>('data/tops.json'),
    fetchJson<Stats>('data/stats.json'),
    fetchJson<Coords>('data/stations.json'),
    fetchJson<Germany>('germany.json'),
  ])
  latest = la; tops = to; stats = st
  if (co) coords = co
  if (ge) germany = ge
  if (!latest && !tops) {
    metaEl.innerHTML = '<span class="err">Keine Daten gefunden — bitte zuerst ' +
      '<code>./temp-leaderboard.sh</code> ausführen.</span>'
    rowsEl.innerHTML = ''
    return
  }
  render()
}

// nur die sich ändernden Live-Dateien neu holen (Auto-Refresh)
async function loadLive(): Promise<void> {
  const [la, to, st] = await Promise.all([
    fetchJson<Snapshot>('data/latest.json'),
    fetchJson<Tops>('data/tops.json'),
    fetchJson<Stats>('data/stats.json'),
  ])
  if (la) latest = la
  if (to) tops = to
  if (st) stats = st
  render()
}

/* ---------- aktive Datenmenge ---------- */
function currentList(): { items: Item[]; metaHtml: string } | null {
  if (view === 'now') {
    if (!latest) return null
    return {
      items: latest.stations.map((s) => ({ id: s.id, name: s.name, value: s.temp_c, obs: s.obs_utc })),
      metaHtml: freshnessHtml(latest.generated_utc) + ` · ${latest.station_count} Stationen`,
    }
  }
  if (!tops) return null
  const p = tops.periods[view]
  if (!p) return null
  const items: Item[] = p.stations
    .map((s) => ({
      id: s.id, name: s.name,
      value: metric === 'max' ? s.max_c : s.min_c,
      obs: metric === 'max' ? s.max_obs_utc : s.min_obs_utc,
    }))
    .filter((it) => typeof it.value === 'number')
  const what = metric === 'max' ? 'Höchstwerte' : 'Tiefstwerte'
  return { items, metaHtml: `${what} <strong>${PERIOD_LABEL[view]}</strong> · ${p.key} · ${items.length} Stationen` }
}

function freshnessHtml(genUtc: string): string {
  const ageMin = (Date.now() - Date.parse(genUtc)) / 60000
  let rel: string
  if (!isFinite(ageMin)) rel = '—'
  else if (ageMin < 1.5) rel = 'gerade aktualisiert'
  else if (ageMin < 60) rel = `aktualisiert vor ${Math.round(ageMin)} min`
  else rel = `aktualisiert vor ${Math.floor(ageMin / 60)} h ${Math.round(ageMin % 60)} min`
  const stale = ageMin > 90
  return `Snapshot <strong>${fmtFull(genUtc)}</strong> · ` +
    `<span class="${stale ? 'stale' : ''}">${rel}${stale ? ' ⚠' : ''}</span>`
}

/* ---------- Rendering ---------- */
function render(): void {
  // Sichtbarkeit der Sekundär-Controls
  metricEl.hidden = view === 'now'
  thTimeEl.textContent = view === 'now' ? 'Messzeit' : (metric === 'max' ? 'Höchstwert am' : 'Tiefstwert am')

  renderStats()

  const data = currentList()
  if (!data) {
    metaEl.innerHTML = '<span class="err">Für diesen Zeitraum liegen noch keine Daten vor.</span>'
    rowsEl.innerHTML = ''; mapWrap.innerHTML = ''
    return
  }
  metaEl.innerHTML = data.metaHtml

  const q = filter.trim().toLowerCase()
  const list = data.items
    .filter((it) => !q || it.name.toLowerCase().includes(q))
    .sort((a, b) => (sortDir === 'hot' ? b.value - a.value : a.value - b.value))

  tableEl.hidden = mapView
  mapWrap.hidden = !mapView
  if (mapView) renderMap(list)
  else renderTable(list, data.items)
}

function renderStats(): void {
  if (!stats) { statsEl.innerHTML = ''; return }
  const parts: string[] = []
  if (stats.hottest) parts.push(`🔥 heiß <b>${esc(stats.hottest.name)} ${stats.hottest.temp_c.toFixed(1)}°</b>`)
  if (stats.coldest) parts.push(`❄ kalt <b>${esc(stats.coldest.name)} ${stats.coldest.temp_c.toFixed(1)}°</b>`)
  if (typeof stats.spread_c === 'number') parts.push(`↕ Spanne <b>${stats.spread_c.toFixed(1)}°</b>`)
  if (stats.top_riser && stats.top_riser.delta_c > 0)
    parts.push(`<span class="up">▲ ${esc(stats.top_riser.name)} +${stats.top_riser.delta_c.toFixed(1)}°</span>`)
  if (stats.top_faller && stats.top_faller.delta_c < 0)
    parts.push(`<span class="down">▼ ${esc(stats.top_faller.name)} ${stats.top_faller.delta_c.toFixed(1)}°</span>`)
  if (stats.records_today) parts.push(`<span class="rec">★ ${stats.records_today} Jahresrekorde heute</span>`)
  statsEl.innerHTML = parts.map((p) => `<span class="stat">${p}</span>`).join('')
}

function renderTable(list: Item[], all: Item[]): void {
  if (list.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="empty">Keine Station passt zu „${esc(filter)}".</td></tr>`
    return
  }
  const vals = all.map((s) => s.value)
  const min = Math.min(...vals)
  const span = Math.max(1, Math.max(...vals) - min)
  rowsEl.innerHTML = list.map((s, i) => {
    const rank = i + 1
    const cls = tempClass(s.value)
    const pct = (((s.value - min) / span) * 100).toFixed(1)
    const top = sortDir === 'hot' && rank <= 3 ? ' is-top' : ''
    return `<tr class="${cls}${top}" data-id="${s.id}">` +
      `<td class="rank">${rank}</td>` +
      `<td class="name">${esc(s.name)}</td>` +
      `<td class="bar"><span class="fill" style="width:${pct}%"></span></td>` +
      `<td class="temp">${s.value.toFixed(1)}°</td>` +
      `<td class="time">${fmtTime(s.obs)}</td></tr>`
  }).join('')
}

/* ---------- Karte ---------- */
let proj: ((lon: number, lat: number) => [number, number]) | null = null
let mapW = 400, mapH = 540

function setupProjection(): void {
  if (!germany) return
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const r of germany.rings) for (const [lo, la] of r) {
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la
  }
  const cos0 = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
  const pad = 10, W = 400
  const xMax = (maxLon - minLon) * cos0, yMax = (maxLat - minLat)
  const H = Math.round((yMax / xMax) * (W - 2 * pad)) + 2 * pad
  const scale = Math.min((W - 2 * pad) / xMax, (H - 2 * pad) / yMax)
  mapW = W; mapH = H
  proj = (lon, lat) => [pad + (lon - minLon) * cos0 * scale, pad + (maxLat - lat) * scale]
}

function renderMap(list: Item[]): void {
  if (!germany) { mapWrap.innerHTML = '<p class="empty">Karte nicht verfügbar.</p>'; return }
  if (!proj) setupProjection()
  const P = proj!
  const land = germany.rings.map((r) => {
    const d = r.map(([lo, la], i) => {
      const [x, y] = P(lo, la); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return `<path class="map-land" d="${d}Z"/>`
  }).join('')

  const dots = list.map((s) => {
    const c = coords[s.id]
    if (!c) return ''
    const [x, y] = P(c.lon, c.lat)
    return `<circle class="map-dot ${tempClass(s.value)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" ` +
      `r="3.4" data-id="${s.id}"><title>${esc(s.name)} ${s.value.toFixed(1)}°</title></circle>`
  }).join('')

  mapWrap.innerHTML =
    `<svg viewBox="0 0 ${mapW} ${mapH}" role="img" aria-label="Karte der Stationen">` +
    land + dots + `</svg>`
}

/* ---------- Legende ---------- */
function renderLegend(): void {
  const bands: [string, string][] = [
    ['tx-cold', '< 5°'], ['tx-cool', '5°'], ['tx-mild', '15°'],
    ['tx-warm', '25°'], ['tx-hot', '30°'], ['tx-scorch', '35°+'],
  ]
  legendEl.innerHTML = bands.map(([cls, lbl]) => {
    const v = '--t-' + cls.slice(3)
    return `<span class="item"><span class="sw" style="background:var(${v})"></span>${lbl}</span>`
  }).join('')
}

/* ---------- Banderole / Funfacts-Laufband ---------- */
function renderTicker(): void {
  const track = document.querySelector<HTMLElement>('#ticker-track')
  if (!track) return
  const sep = '<span class="sep"> ❄ </span>'
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // kein Scrollen: einzelnen Fakt anzeigen und langsam durchwechseln
    track.classList.add('static')
    let i = 0
    const show = () => { track.innerHTML = `<span class="ff">${esc(FUNFACTS[i])}</span>`; i = (i + 1) % FUNFACTS.length }
    show(); setInterval(show, 8000)
    return
  }
  const block = FUNFACTS.map((f) => `<span class="ff">${esc(f)}</span>`).join(sep) + sep
  track.innerHTML = block + block   // zwei identische Blöcke -> nahtlose -50%-Schleife
}

/* ---------- Detail / Sparkline ---------- */
async function openDetail(id: string): Promise<void> {
  detailEl.hidden = false
  detailBody.innerHTML = '<p class="empty">lädt …</p>'
  if (!series && !seriesLoading) {
    seriesLoading = true
    series = await fetchJson<Series>('data/series.json')
    seriesLoading = false
  }
  renderDetail(id)
}

function renderDetail(id: string): void {
  const name = coords[id]?.name ?? latest?.stations.find((s) => s.id === id)?.name ?? id
  const cur = latest?.stations.find((s) => s.id === id)
  const y = tops?.periods.year.stations.find((s) => s.id === id)

  // Sparkline-Daten
  const ser = series?.stations[id]
  const dates = series?.dates ?? []
  let isRecordToday = false
  let todayMax: number | null = null
  if (ser && dates.length) {
    const ti = dates.length - 1
    todayMax = ser.max[ti]
    const prior = ser.max.slice(0, ti).filter((v): v is number => v != null)
    if (todayMax != null && prior.length && todayMax >= Math.max(...prior)) isRecordToday = true
  }

  const facts: string[] = []
  if (cur) facts.push(fact('Aktuell', `${cur.temp_c.toFixed(1)}°`, tempClass(cur.temp_c)))
  if (y && y.max_c != null) facts.push(fact('Jahres-Max', `${y.max_c.toFixed(1)}°`, tempClass(y.max_c), fmtTime(y.max_obs_utc)))
  if (y && y.min_c != null) facts.push(fact('Jahres-Min', `${y.min_c.toFixed(1)}°`, tempClass(y.min_c), fmtTime(y.min_obs_utc)))

  // Zeitraum-Label aus der tatsächlichen Datenspanne (z. B. „2025–2026")
  const yFrom = dates.length ? dates[0].slice(0, 4) : ''
  const yTo = dates.length ? dates[dates.length - 1].slice(0, 4) : ''
  const span = yFrom ? (yFrom === yTo ? yFrom : `${yFrom}–${yTo}`) : ''

  detailBody.innerHTML =
    `<h2>${esc(name)}${isRecordToday ? '<span class="detail-badge">★ Jahresrekord heute</span>' : ''}</h2>` +
    `<div class="detail-sub">Temperaturverlauf ${span} · Tagesmaximum & -minimum</div>` +
    `<div class="facts">${facts.join('')}</div>` +
    (ser ? sparkSvg(ser, dates) : '<p class="empty">Kein Verlauf verfügbar.</p>') +
    (ser ? '<div class="spark-legend"><span class="mx">— Max</span>　<span class="mn">— Min</span></div>' : '')
}

function fact(k: string, v: string, cls: string, sub?: string): string {
  return `<div class="fact"><div class="k">${k}</div>` +
    `<div class="v ${cls}">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`
}

function sparkSvg(ser: { max: (number | null)[]; min: (number | null)[] }, dates: string[]): string {
  const W = 540, H = 150, padL = 30, padR = 8, padT = 10, padB = 16
  const n = dates.length
  const xs = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR)
  const all = [...ser.max, ...ser.min].filter((v): v is number => v != null)
  if (!all.length) return '<p class="empty">Kein Verlauf verfügbar.</p>'
  let lo = Math.min(...all), hi = Math.max(...all)
  if (hi - lo < 1) { hi += 1; lo -= 1 }
  const ys = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)

  const line = (arr: (number | null)[]) => {
    let d = '', pen = false
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)} `; pen = true
    })
    return d.trim()
  }
  // Band zwischen Min und Max
  let band = ''
  const fwd: string[] = [], bwd: string[] = []
  for (let i = 0; i < n; i++) {
    const mx = ser.max[i], mn = ser.min[i]
    if (mx != null) fwd.push(`${xs(i).toFixed(1)},${ys(mx).toFixed(1)}`)
    if (mn != null) bwd.push(`${xs(i).toFixed(1)},${ys(mn).toFixed(1)}`)
  }
  if (fwd.length && bwd.length) band = `<polygon class="spark-band" points="${fwd.join(' ')} ${bwd.reverse().join(' ')}"/>`

  const zero = (lo < 0 && hi > 0) ? `<line class="spark-zero" x1="${padL}" y1="${ys(0).toFixed(1)}" x2="${W - padR}" y2="${ys(0).toFixed(1)}"/>` : ''
  const lbls =
    `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi.toFixed(0)}°</text>` +
    `<text class="spark-lbl" x="2" y="${(ys(lo) + 3).toFixed(1)}">${lo.toFixed(0)}°</text>` +
    `<text class="spark-lbl" x="${padL}" y="${H - 3}">${fmtDate(dates[0])}</text>` +
    `<text class="spark-lbl" x="${W - padR}" y="${H - 3}" text-anchor="end">${fmtDate(dates[n - 1])}</text>`

  return `<svg class="spark" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    band + zero +
    `<path class="spark-min" d="${line(ser.min)}"/>` +
    `<path class="spark-max" d="${line(ser.max)}"/>` +
    lbls + `</svg>`
}

function closeDetail(): void { detailEl.hidden = true; detailBody.innerHTML = '' }

/* ---------- URL-State ---------- */
function readHash(): void {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  const validP: View[] = ['now', 'day', 'week', 'month', 'year']
  if (parts[0] && validP.includes(parts[0] as View)) view = parts[0] as View
  if (parts.includes('min')) metric = 'min'; else if (parts.includes('max')) metric = 'max'
  mapView = parts.includes('map')
  sortDir = metric === 'min' ? 'cold' : 'hot'
}
function writeHash(): void {
  const parts: string[] = [view]
  if (view !== 'now') parts.push(metric)
  if (mapView) parts.push('map')
  const h = '#' + parts.join('/')
  if (location.hash !== h) history.replaceState(null, '', h)
}
function syncControls(): void {
  for (const b of periodsEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.period === view)
  for (const b of metricEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.metric === metric)
  for (const b of viewEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.view === (mapView ? 'map' : 'table'))
}

/* ---------- Theme ---------- */
function applyTheme(t: string): void {
  document.documentElement.dataset.theme = t
  themeEl.textContent = t === 'dark' ? '☀' : '☾'
  try { localStorage.setItem('theme', t) } catch { /* ignore */ }
}

/* ---------- Events ---------- */
periodsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-period]')
  if (!b) return
  view = b.dataset.period as View
  syncControls(); writeHash(); render()
})
metricEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-metric]')
  if (!b) return
  metric = b.dataset.metric as Metric
  // sinnvolle Default-Sortierung: Tiefstwerte -> kälteste zuerst
  sortDir = metric === 'min' ? 'cold' : 'hot'
  sortEl.innerHTML = sortDir === 'hot' ? '&#8595; Heißeste zuerst' : '&#8593; Kälteste zuerst'
  syncControls(); writeHash(); render()
})
viewEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')
  if (!b) return
  mapView = b.dataset.view === 'map'
  syncControls(); writeHash(); render()
})
filterEl.addEventListener('input', () => { filter = filterEl.value; render() })
sortEl.addEventListener('click', () => {
  sortDir = sortDir === 'hot' ? 'cold' : 'hot'
  sortEl.innerHTML = sortDir === 'hot' ? '&#8595; Heißeste zuerst' : '&#8593; Kälteste zuerst'
  render()
})
reloadEl.addEventListener('click', () => void loadLive())

rowsEl.addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]')
  if (tr) void openDetail(tr.dataset.id!)
})
mapWrap.addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<SVGElement>('[data-id]')
  if (c) void openDetail((c as unknown as HTMLElement).dataset.id!)
})
$<HTMLButtonElement>('#detail-close').addEventListener('click', closeDetail)
detailEl.addEventListener('click', (e) => { if (e.target === detailEl) closeDetail() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail() })
themeEl.addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))

/* ---------- Start ---------- */
{
  let t: string | null = null
  try { t = localStorage.getItem('theme') } catch { /* ignore */ }
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  applyTheme(t)
}
readHash()
syncControls()
sortEl.innerHTML = sortDir === 'hot' ? '&#8595; Heißeste zuerst' : '&#8593; Kälteste zuerst'
renderLegend()
renderTicker()
void loadAll()
setInterval(() => void loadLive(), 5 * 60 * 1000) // Auto-Refresh alle 5 min
