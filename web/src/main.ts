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
  vs_last_year?: { date: string; delta_c: number; n: number }
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
const yearSelEl = $<HTMLElement>('#yearsel')
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
let seriesPromise: Promise<void> | null = null

let view: View = 'now'
let metric: Metric = 'max'
let sortDir: SortDir = 'hot'
let mapView = false
let filter = ''
let yearSel = 'current'              // bei view==='year': 'current' | '<jahr>' | 'all'
let detailId: string | null = null
let detailTab: 'verlauf' | 'kalender' = 'verlauf'

// series.json (Verlauf je Station) einmalig nachladen
function ensureSeries(): Promise<void> {
  if (!seriesPromise) seriesPromise = fetchJson<Series>('data/series.json').then((s) => { series = s })
  return seriesPromise
}

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
  buildYearSel(); syncControls()
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
  // Jahr-Sub-Auswahl (2025 / Allzeit) -> client-seitig aus series.json
  if (view === 'year' && yearSel !== 'current') {
    if (!series) return null
    const items = computeYearItems(yearSel === 'all' ? null : +yearSel)
    const label = yearSel === 'all' ? 'Allzeit' : yearSel
    const what = metric === 'max' ? 'Höchstwerte' : 'Tiefstwerte'
    return { items, metaHtml: `${what} <strong>${label}</strong> · ${items.length} Stationen` }
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

// Rangliste eines Jahres (oder Allzeit, year=null) aus series.json berechnen
function computeYearItems(year: number | null): Item[] {
  if (!series) return []
  const { dates, stations } = series
  const items: Item[] = []
  for (const id in stations) {
    const s = stations[id]
    let bMax: number | null = null, bMaxD = '', bMin: number | null = null, bMinD = ''
    for (let i = 0; i < dates.length; i++) {
      if (year !== null && +dates[i].slice(0, 4) !== year) continue
      const mx = s.max[i], mn = s.min[i]
      if (mx != null && (bMax === null || mx > bMax)) { bMax = mx; bMaxD = dates[i] }
      if (mn != null && (bMin === null || mn < bMin)) { bMin = mn; bMinD = dates[i] }
    }
    const val = metric === 'max' ? bMax : bMin
    if (val == null) continue
    items.push({ id, name: coords[id]?.name ?? id, value: val, obs: metric === 'max' ? bMaxD : bMinD })
  }
  return items
}

// Jahr-Umschalter füllen (aktuelles Jahr · Vorjahr · Allzeit)
function buildYearSel(): void {
  const cy = tops?.periods.year.key ?? String(new Date().getFullYear())
  const opts: [string, string][] = [['current', cy], [String(+cy - 1), String(+cy - 1)], ['all', 'Allzeit']]
  yearSelEl.innerHTML = opts.map(([v, l]) =>
    `<button type="button" data-year="${v}">${l}</button>`).join('')
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
  yearSelEl.hidden = view !== 'year'
  thTimeEl.textContent = view === 'now' ? 'Messzeit' : (metric === 'max' ? 'Höchstwert am' : 'Tiefstwert am')

  renderStats()

  // Jahr-Sub-Ansicht braucht series.json -> ggf. nachladen, dann erneut rendern
  if (view === 'year' && yearSel !== 'current' && !series) {
    metaEl.textContent = 'lädt Verlaufsdaten …'
    rowsEl.innerHTML = ''; mapWrap.innerHTML = ''
    void ensureSeries().then(render)
    return
  }

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
  if (stats.vs_last_year) {
    const d = stats.vs_last_year.delta_c
    parts.push(`<span class="${d >= 0 ? 'up' : 'down'}">↔ ggü. ${stats.vs_last_year.date.slice(0, 4)} ⌀ ${d >= 0 ? '+' : ''}${d.toFixed(1)}°</span>`)
  }
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

/* ---------- Detail: Verlauf-Overlay + Kalender ---------- */
type SeriesEntry = { max: (number | null)[]; min: (number | null)[] }

async function openDetail(id: string): Promise<void> {
  detailId = id
  detailTab = 'verlauf'
  detailEl.hidden = false
  detailBody.innerHTML = '<p class="empty">lädt …</p>'
  await ensureSeries()
  renderDetail()
}

function doy(ds: string): number {
  const [Y, M, D] = ds.split('-').map(Number)
  return Math.floor((Date.UTC(Y, M - 1, D) - Date.UTC(Y, 0, 1)) / 86400000) + 1
}

function lastYearValue(ser: SeriesEntry, dates: string[]): { max: number; delta: number } | null {
  if (!dates.length) return null
  const ti = dates.length - 1
  const tm = ser.max[ti]
  if (tm == null) return null
  const [Y, M, D] = dates[ti].split('-')
  const idx = dates.indexOf(`${+Y - 1}-${M}-${D}`)
  if (idx < 0) return null
  const lm = ser.max[idx]
  if (lm == null) return null
  return { max: lm, delta: tm - lm }
}

function countersHtml(ser: SeriesEntry, dates: string[]): string {
  if (!dates.length) return ''
  const curY = +dates[dates.length - 1].slice(0, 4)
  const prevY = curY - 1
  const doyT = doy(dates[dates.length - 1])
  const count = (year: number, untilDoy: number) => {
    let hot = 0, trop = 0
    dates.forEach((ds, i) => {
      if (+ds.slice(0, 4) !== year) return
      if (untilDoy && doy(ds) > untilDoy) return
      const mx = ser.max[i], mn = ser.min[i]
      if (mx != null && mx >= 30) hot++
      if (mn != null && mn >= 20) trop++
    })
    return { hot, trop }
  }
  const c = count(curY, 0)
  const p = count(prevY, doyT)
  return `<div class="counters">` +
    `<span class="ctr">Hitzetage ≥30° <b>${c.hot}</b> <span class="dim">${prevY} z. Stichtag: ${p.hot}</span></span>` +
    `<span class="ctr">Tropennächte ≥20° <b>${c.trop}</b> <span class="dim">${prevY}: ${p.trop}</span></span>` +
    `</div>`
}

function renderDetail(): void {
  const id = detailId
  if (!id) return
  const name = coords[id]?.name ?? latest?.stations.find((s) => s.id === id)?.name ?? id
  const cur = latest?.stations.find((s) => s.id === id)
  const y = tops?.periods.year.stations.find((s) => s.id === id)
  const ser = series?.stations[id]
  const dates = series?.dates ?? []

  let isRecordToday = false
  if (ser && dates.length) {
    const ti = dates.length - 1, tm = ser.max[ti]
    const prior = ser.max.slice(0, ti).filter((v): v is number => v != null)
    if (tm != null && prior.length && tm >= Math.max(...prior)) isRecordToday = true
  }

  const facts: string[] = []
  if (cur) facts.push(fact('Aktuell', `${cur.temp_c.toFixed(1)}°`, tempClass(cur.temp_c)))
  if (y && y.max_c != null) facts.push(fact('Jahres-Max', `${y.max_c.toFixed(1)}°`, tempClass(y.max_c), fmtTime(y.max_obs_utc)))
  if (y && y.min_c != null) facts.push(fact('Jahres-Min', `${y.min_c.toFixed(1)}°`, tempClass(y.min_c), fmtTime(y.min_obs_utc)))
  if (ser) {
    const ly = lastYearValue(ser, dates)
    if (ly) facts.push(fact('vor 1 Jahr', `${ly.max.toFixed(1)}°`, tempClass(ly.max),
      `${ly.delta >= 0 ? '+' : ''}${ly.delta.toFixed(1)}° ggü. heute`))
  }

  const tabs = `<div class="seg detail-tabs">` +
    `<button data-tab="verlauf" class="${detailTab === 'verlauf' ? 'active' : ''}">Verlauf</button>` +
    `<button data-tab="kalender" class="${detailTab === 'kalender' ? 'active' : ''}">Kalender</button></div>`

  let panel = '<p class="empty">Kein Verlauf verfügbar.</p>'
  if (ser) panel = detailTab === 'verlauf'
    ? overlaySparkSvg(ser, dates) + overlayLegend(dates)
    : calendarPanel(ser, dates)

  detailBody.innerHTML =
    `<h2>${esc(name)}${isRecordToday ? '<span class="detail-badge">★ Jahresrekord heute</span>' : ''}</h2>` +
    `<div class="detail-sub">Tagesmaximum & -minimum je Tag</div>` +
    `<div class="facts">${facts.join('')}</div>` +
    (ser ? countersHtml(ser, dates) : '') +
    tabs +
    `<div class="detail-panel">${panel}</div>`
}

function fact(k: string, v: string, cls: string, sub?: string): string {
  return `<div class="fact"><div class="k">${k}</div>` +
    `<div class="v ${cls}">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`
}

function overlaySparkSvg(ser: SeriesEntry, dates: string[]): string {
  const byYear = new Map<number, SeriesEntry>()
  dates.forEach((ds, i) => {
    const Y = +ds.slice(0, 4), dd = doy(ds)
    let o = byYear.get(Y)
    if (!o) { o = { max: Array(367).fill(null), min: Array(367).fill(null) }; byYear.set(Y, o) }
    o.max[dd] = ser.max[i]; o.min[dd] = ser.min[i]
  })
  const years = [...byYear.keys()].sort((a, b) => a - b)
  const vals: number[] = []
  byYear.forEach((o) => { for (const v of o.max) if (v != null) vals.push(v); for (const v of o.min) if (v != null) vals.push(v) })
  if (!vals.length) return '<p class="empty">Kein Verlauf verfügbar.</p>'
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < 1) { hi += 1; lo -= 1 }
  const W = 540, H = 170, padL = 26, padR = 8, padT = 10, padB = 22
  const xs = (d: number) => padL + ((d - 1) / 365) * (W - padL - padR)
  const ys = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const line = (arr: (number | null)[]) => {
    let d = '', pen = false
    for (let i = 1; i <= 366; i++) {
      const v = arr[i]
      if (v == null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)} `; pen = true
    }
    return d.trim()
  }
  const curY = years[years.length - 1]
  let paths = ''
  for (const Y of years) {
    const o = byYear.get(Y)!
    const f = Y !== curY ? ' faint' : ''
    paths += `<path class="spark-min${f}" d="${line(o.min)}"/><path class="spark-max${f}" d="${line(o.max)}"/>`
  }
  const zero = (lo < 0 && hi > 0)
    ? `<line class="spark-zero" x1="${padL}" y1="${ys(0).toFixed(1)}" x2="${W - padR}" y2="${ys(0).toFixed(1)}"/>` : ''
  const mDoy = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
  const mLbl = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
  let months = ''
  mDoy.forEach((d, i) => { months += `<text class="spark-lbl" x="${xs(d).toFixed(1)}" y="${H - 4}">${mLbl[i]}</text>` })
  const yl = `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi.toFixed(0)}°</text>` +
    `<text class="spark-lbl" x="2" y="${(ys(lo) + 3).toFixed(1)}">${lo.toFixed(0)}°</text>`
  return `<svg class="spark" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    zero + paths + months + yl + `</svg>`
}

function overlayLegend(dates: string[]): string {
  const years = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const curY = years[years.length - 1]
  const yl = years.map((y) => `<span class="${y === curY ? '' : 'faintlbl'}">${y}</span>`).join(' · ')
  return `<div class="spark-legend">${yl} &nbsp; <span class="mx">— Max</span> <span class="mn">— Min</span></div>`
}

function calendarPanel(ser: SeriesEntry, dates: string[]): string {
  const years = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  return `<div class="cal-wrap">${years.map((y) => calendarSvg(ser, dates, y)).join('')}</div>` +
    `<div class="spark-legend">eine Zelle = ein Tag · Farbe = Tagesmaximum</div>`
}

function calendarSvg(ser: SeriesEntry, dates: string[], year: number): string {
  const cell = 9, gap = 1.6
  const maxByDoy: (number | null)[] = Array(367).fill(null)
  dates.forEach((ds, i) => { if (+ds.slice(0, 4) === year) maxByDoy[doy(ds)] = ser.max[i] })
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay()
  const off = (jan1 + 6) % 7
  const days = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
  let cells = '', maxCol = 0
  for (let d = 1; d <= days; d++) {
    const idx = d - 1 + off
    const col = Math.floor(idx / 7), row = idx % 7
    if (col > maxCol) maxCol = col
    const v = maxByDoy[d]
    const cls = v == null ? 'cal-empty' : tempClass(v)
    const dt = new Date(Date.UTC(year, 0, d))
    const ds = `${year}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    cells += `<rect class="cal ${cls}" x="${(col * (cell + gap)).toFixed(1)}" y="${(row * (cell + gap)).toFixed(1)}" width="${cell}" height="${cell}"><title>${fmtDate(ds)}: ${v == null ? '—' : v.toFixed(1) + '°'}</title></rect>`
  }
  const W = (maxCol + 1) * (cell + gap), H = 7 * (cell + gap)
  return `<div class="cal-year"><div class="cal-label">${year}</div>` +
    `<svg class="cal-svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="xMinYMin meet">${cells}</svg></div>`
}

function closeDetail(): void { detailEl.hidden = true; detailBody.innerHTML = '' }

/* ---------- URL-State ---------- */
function readHash(): void {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  const validP: View[] = ['now', 'day', 'week', 'month', 'year']
  if (parts[0] && validP.includes(parts[0] as View)) view = parts[0] as View
  if (parts.includes('min')) metric = 'min'; else if (parts.includes('max')) metric = 'max'
  mapView = parts.includes('map')
  const yr = parts.find((p) => /^\d{4}$/.test(p))
  yearSel = parts.includes('all') ? 'all' : (yr ?? 'current')
  sortDir = metric === 'min' ? 'cold' : 'hot'
}
function writeHash(): void {
  const parts: string[] = [view]
  if (view !== 'now') parts.push(metric)
  if (view === 'year' && yearSel !== 'current') parts.push(yearSel)
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
  for (const b of yearSelEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.year === yearSel)
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
yearSelEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-year]')
  if (!b) return
  yearSel = b.dataset.year!
  syncControls(); writeHash(); render()
})
detailBody.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]')
  if (!b) return
  detailTab = b.dataset.tab as 'verlauf' | 'kalender'
  renderDetail()
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
