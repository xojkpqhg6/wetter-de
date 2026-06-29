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
interface PeriodTop { key: string; station_count: number; hidden?: number; stations: TopStation[] }
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
const recordsEl = $<HTMLElement>('#records')
const controlsEl = $<HTMLElement>('.controls')

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
let viewMode: 'table' | 'map' | 'rekorde' = 'table'
let filter = ''
let yearSel = 'current'              // bei view==='year': 'current' | '<jahr>' | 'all'
let recYear = 'all'                  // Rekorde-Filter: 'all' | '<jahr>'
let detailId: string | null = null
type DetailTab = 'verlauf' | 'vmax' | 'vmin' | 'kalender'
let detailTab: DetailTab = 'verlauf'

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
  const hideNote = (n: number) => (n ? ` · ${n} mit zu wenig Daten ausgeblendet` : '')
  // Jahr-Sub-Auswahl (2025 / Allzeit) -> client-seitig aus series.json
  if (view === 'year' && yearSel !== 'current') {
    if (!series) return null
    const { items, hidden } = computeYearItems(yearSel === 'all' ? null : +yearSel)
    const label = yearSel === 'all' ? 'Allzeit' : yearSel
    const what = metric === 'max' ? 'Höchstwerte' : 'Tiefstwerte'
    return { items, metaHtml: `${what} <strong>${label}</strong> · ${items.length} Stationen${hideNote(hidden)}` }
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
  return { items, metaHtml: `${what} <strong>${PERIOD_LABEL[view]}</strong> · ${p.key} · ${items.length} Stationen${hideNote(p.hidden ?? 0)}` }
}

// Rangliste eines Jahres (oder Allzeit, year=null) aus series.json.
// Stationen mit <60 % Tagesabdeckung (im Jahr bzw. im besten Jahr) werden ausgeblendet.
function computeYearItems(year: number | null): { items: Item[]; hidden: number } {
  if (!series) return { items: [], hidden: 0 }
  const { dates, stations } = series
  const yIdx = dates.map((d) => +d.slice(0, 4))
  const yearTotal: Record<number, number> = {}
  for (const y of yIdx) yearTotal[y] = (yearTotal[y] || 0) + 1
  const items: Item[] = []
  let hidden = 0
  for (const id in stations) {
    const s = stations[id]
    let bMax: number | null = null, bMaxD = '', bMin: number | null = null, bMinD = ''
    const dpy: Record<number, number> = {}
    for (let i = 0; i < dates.length; i++) {
      const Y = yIdx[i]
      if (year !== null && Y !== year) continue
      const mx = s.max[i], mn = s.min[i]
      if (mx != null) { dpy[Y] = (dpy[Y] || 0) + 1; if (bMax === null || mx > bMax) { bMax = mx; bMaxD = dates[i] } }
      if (mn != null && (bMin === null || mn < bMin)) { bMin = mn; bMinD = dates[i] }
    }
    const val = metric === 'max' ? bMax : bMin
    if (val == null) continue
    let cov = 0
    if (year !== null) cov = (dpy[year] || 0) / (yearTotal[year] || 1)
    else for (const Y in dpy) cov = Math.max(cov, dpy[Y] / (yearTotal[+Y] || 1))
    if (cov < 0.6) { hidden++; continue }
    items.push({ id, name: coords[id]?.name ?? id, value: val, obs: metric === 'max' ? bMaxD : bMinD })
  }
  return { items, hidden }
}

// Jahr-Umschalter füllen (aktuelles Jahr · Vorjahr · Allzeit)
function buildYearSel(): void {
  const cy = tops?.periods.year.key ?? String(new Date().getFullYear())
  const opts: [string, string][] = [['current', cy], [String(+cy - 1), String(+cy - 1)], ['all', 'Allzeit']]
  yearSelEl.innerHTML = opts.map(([v, l]) =>
    `<button type="button" data-year="${v}">${l}</button>`).join('')
}

/* ---------- Rekorde-Tafel (aus series.json) ---------- */
type RecResult = { id: string; name: string; valueText: string; sub: string; cls: string }

// Schutz gegen Einzel-Ausreißer: Rekordhalter braucht eine Mindest-Datenmenge.
const REC_MIN_DAYS = 10
const _daysCache = new Map<string, number>()
function stationDataDays(id: string): number {
  let c = _daysCache.get(id)
  if (c === undefined) {
    c = 0
    for (const v of series?.stations[id]?.max ?? []) if (v != null) c++
    _daysCache.set(id, c)
  }
  return c
}

function recExtreme(yr: number | null, key: 'max' | 'min', wantMax: boolean): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  let best: { id: string; v: number; date: string; name: string } | null = null
  for (const id in stations) {
    if (stationDataDays(id) < REC_MIN_DAYS) continue
    const arr = key === 'max' ? stations[id].max : stations[id].min
    for (let i = 0; i < dates.length; i++) {
      if (yr !== null && +dates[i].slice(0, 4) !== yr) continue
      const v = arr[i]
      if (v == null) continue
      if (best === null || (wantMax ? v > best.v : v < best.v))
        best = { id, v, date: dates[i], name: coords[id]?.name ?? id }
    }
  }
  if (!best) return null
  return { id: best.id, name: best.name, valueText: `${best.v.toFixed(1)}°`, sub: `${best.name} · ${fmtDate(best.date)}`, cls: tempClass(best.v) }
}

function recWarmestNight(yr: number | null): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  const today = dates[dates.length - 1]            // laufenden Tag auslassen: Min noch unvollständig
  let best: { id: string; v: number; date: string; name: string } | null = null
  for (const id in stations) {
    if (stationDataDays(id) < REC_MIN_DAYS) continue
    const mn = stations[id].min
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] === today) continue
      if (yr !== null && +dates[i].slice(0, 4) !== yr) continue
      const v = mn[i]
      if (v == null) continue
      if (best === null || v > best.v) best = { id, v, date: dates[i], name: coords[id]?.name ?? id }
    }
  }
  if (!best) return null
  return { id: best.id, name: best.name, valueText: `${best.v.toFixed(1)}°`, sub: `${best.name} · ${fmtDate(best.date)}`, cls: tempClass(best.v) }
}

function recLargestSpan(yr: number | null): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  let best: { id: string; sp: number; mx: number; mn: number; date: string; name: string } | null = null
  for (const id in stations) {
    if (stationDataDays(id) < REC_MIN_DAYS) continue
    const s = stations[id]
    for (let i = 0; i < dates.length; i++) {
      if (yr !== null && +dates[i].slice(0, 4) !== yr) continue
      const mx = s.max[i], mn = s.min[i]
      if (mx == null || mn == null) continue
      const sp = mx - mn
      if (best === null || sp > best.sp) best = { id, sp, mx, mn, date: dates[i], name: coords[id]?.name ?? id }
    }
  }
  if (!best) return null
  return { id: best.id, name: best.name, valueText: `${best.sp.toFixed(1)}°`, sub: `${best.name} · ${fmtDate(best.date)} (${best.mn.toFixed(1)}…${best.mx.toFixed(1)}°)`, cls: '' }
}

function recStreak(yr: number | null, thr: number, above: boolean): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  let best: { id: string; name: string; len: number; start: string; end: string } | null = null
  for (const id in stations) {
    const mx = stations[id].max
    let run = 0, startIdx = -1
    for (let i = 0; i < dates.length; i++) {
      if (yr !== null && +dates[i].slice(0, 4) !== yr) { run = 0; continue }
      const v = mx[i]
      const ok = v != null && (above ? v >= thr : v < thr)
      if (ok) {
        if (run === 0) startIdx = i
        run++
        if (best === null || run > best.len)
          best = { id, name: coords[id]?.name ?? id, len: run, start: dates[startIdx], end: dates[i] }
      } else run = 0
    }
  }
  if (!best || best.len < 2) return null
  return { id: best.id, name: best.name, valueText: `${best.len} Tage`, sub: `${best.name} · ${fmtDate(best.start)}–${fmtDate(best.end)}`, cls: '' }
}

function recMostDays(yr: number | null, thr: number, key: 'max' | 'min', unit: string): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  let best: { id: string; name: string; count: number; year: string } | null = null
  for (const id in stations) {
    const arr = key === 'max' ? stations[id].max : stations[id].min
    const byYear: Record<string, number> = {}
    for (let i = 0; i < dates.length; i++) {
      const Y = dates[i].slice(0, 4)
      if (yr !== null && +Y !== yr) continue
      const v = arr[i]
      if (v != null && v >= thr) byYear[Y] = (byYear[Y] || 0) + 1
    }
    for (const Y in byYear) {
      if (best === null || byYear[Y] > best.count) best = { id, name: coords[id]?.name ?? id, count: byYear[Y], year: Y }
    }
  }
  if (!best) return null
  return { id: best.id, name: best.name, valueText: `${best.count} ${unit}`, sub: `${best.name} · ${best.year}`, cls: '' }
}

// Anzahl DISTINKTER Tage in einem Jahr, an denen mind. eine Station die Bedingung erfüllt
function distinctEventDays(yr: number, thr: number, key: 'max' | 'min'): number {
  if (!series) return 0
  const { dates, stations } = series
  const hit = new Array(dates.length).fill(false)
  for (const id in stations) {
    const arr = key === 'max' ? stations[id].max : stations[id].min
    for (let i = 0; i < dates.length; i++) {
      if (hit[i]) continue
      if (+dates[i].slice(0, 4) !== yr) continue
      const v = arr[i]
      if (v != null && v >= thr) hit[i] = true
    }
  }
  return hit.filter(Boolean).length
}

// Kennzahl für die Info-Zeile: konkretes Jahr -> dessen Wert; "Gesamt" -> bestes
// Einzeljahr (über Jahre zu addieren wäre sinnlos).
function eventHeadline(thr: number, key: 'max' | 'min'): { count: number; year: string } {
  if (!series) return { count: 0, year: '' }
  if (recYear !== 'all') return { count: distinctEventDays(+recYear, thr, key), year: recYear }
  const years = [...new Set(series.dates.map((d) => +d.slice(0, 4)))]
  let best = { count: -1, year: '' }
  for (const y of years) {
    const c = distinctEventDays(y, thr, key)
    if (c > best.count) best = { count: c, year: String(y) }
  }
  return best
}

function recCard(icon: string, label: string, rec: RecResult | null, note?: string): string {
  const head = `<span class="rec-ico">${icon}</span><span class="rec-k">${label}${note ? ` <span class="rec-note">${note}</span>` : ''}</span>`
  if (!rec) return `<div class="rec-card is-empty">${head}<span class="rec-sub">keine Daten</span></div>`
  return `<button type="button" class="rec-card" data-id="${rec.id}">${head}` +
    `<span class="rec-v ${rec.cls}">${rec.valueText}</span>` +
    `<span class="rec-sub">${esc(rec.sub)}</span></button>`
}

// nicht-klickbare Karte für nationale Kennzahlen (keine Einzelstation)
function statCard(icon: string, label: string, valueText: string, sub: string): string {
  return `<div class="rec-card is-stat"><span class="rec-ico">${icon}</span>` +
    `<span class="rec-k">${label}</span><span class="rec-v">${valueText}</span>` +
    `<span class="rec-sub">${esc(sub)}</span></div>`
}

function renderRecords(): void {
  if (!series) return
  const years = [...new Set(series.dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const opts = ['all', ...years.map(String)]
  const bar = `<div class="seg rec-filter">` + opts.map((v) =>
    `<button type="button" data-recyear="${v}" class="${recYear === v ? 'active' : ''}">${v === 'all' ? 'Gesamt' : v}</button>`).join('') + `</div>`
  const yr = recYear === 'all' ? null : +recYear
  const hot = eventHeadline(30, 'max')
  const trop = eventHeadline(20, 'min')
  const yrNote = (y: string) => (recYear === 'all' ? `Rekordjahr ${y}` : y)
  const cards = [
    // Reihe 1 — Extreme
    recCard('🔥', 'Höchste Temperatur', recExtreme(yr, 'max', true)),
    recCard('❄', 'Tiefste Temperatur', recExtreme(yr, 'min', false)),
    recCard('🌡', 'Größte Tagesspanne', recLargestSpan(yr)),
    // Reihe 2 — Nächte
    recCard('🌴', 'Wärmste Nacht', recWarmestNight(yr), 'ohne heute'),
    recCard('🌙', 'Meiste Tropennächte', recMostDays(yr, 20, 'min', 'Nächte')),
    statCard('📅', 'Tropennächte gesamt', `${trop.count} Nächte`, yrNote(trop.year)),
    // Reihe 3 — Hitze
    recCard('♨', 'Längste Hitzeserie', recStreak(yr, 30, true)),
    recCard('☀', 'Meiste Hitzetage', recMostDays(yr, 30, 'max', 'Tage')),
    statCard('📅', 'Hitzetage gesamt', `${hot.count} Tage`, yrNote(hot.year)),
  ]
  const ice = recStreak(yr, 0, false)
  const info = ice
    ? `<div class="rec-info"><span>🧊 Längste Eisserie <b>${ice.valueText}</b> <span class="dim">${esc(ice.sub)}</span></span></div>`
    : ''
  recordsEl.innerHTML = bar + `<div class="rec-grid">${cards.join('')}</div>` + info
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
  const rek = viewMode === 'rekorde'
  // Sichtbarkeit der Controls (in Rekorde-Ansicht ist das meiste irrelevant)
  periodsEl.hidden = rek
  controlsEl.hidden = rek
  legendEl.hidden = rek
  metricEl.hidden = rek || view === 'now'
  yearSelEl.hidden = rek || view !== 'year'
  thTimeEl.textContent = view === 'now' ? 'Messzeit' : (metric === 'max' ? 'Höchstwert am' : 'Tiefstwert am')

  renderStats()

  // --- Rekorde-Tafel ---
  if (rek) {
    tableEl.hidden = true; mapWrap.hidden = true; recordsEl.hidden = false
    if (!series) {
      metaEl.textContent = 'lädt Verlaufsdaten …'; recordsEl.innerHTML = ''
      void ensureSeries().then(render); return
    }
    metaEl.innerHTML = `Rekorde · <strong>${recYear === 'all' ? 'seit Aufzeichnung 2025' : recYear}</strong>`
    renderRecords()
    return
  }
  recordsEl.hidden = true

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

  tableEl.hidden = viewMode !== 'table'
  mapWrap.hidden = viewMode !== 'map'
  if (viewMode === 'map') renderMap(list)
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
type SparkCtx = {
  byYear: Map<number, SeriesEntry>; years: number[]
  lo: number; hi: number; W: number; H: number
  padL: number; padR: number; padT: number; padB: number
}
let sparkCtx: SparkCtx | null = null

type DistCtx = {
  counts: Map<number, Map<number, number>>; totals: Map<number, number>; years: number[]
  lo: number; hi: number; maxPct: number; metric: 'max' | 'min'
  W: number; H: number; padL: number; padR: number; padT: number; padB: number
}
let distCtx: DistCtx | null = null

// gemeinsamer Hover-Tooltip (Graph + Kalender)
let tipEl: HTMLElement | null = null
function showTip(html: string, x: number, y: number): void {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; document.body.appendChild(tipEl) }
  tipEl.innerHTML = html
  tipEl.style.display = 'block'
  const r = tipEl.getBoundingClientRect()
  let left = x + 14, top = y + 14
  if (left + r.width > window.innerWidth - 6) left = x - r.width - 14
  if (top + r.height > window.innerHeight - 6) top = y - r.height - 14
  tipEl.style.left = Math.max(6, left) + 'px'
  tipEl.style.top = Math.max(6, top) + 'px'
}
function hideTip(): void { if (tipEl) tipEl.style.display = 'none' }
function clearGuide(): void {
  detailBody.querySelectorAll('.spark-guide, .dist-guide').forEach((g) => { g.innerHTML = '' })
}

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

  const tabBtn = (t: DetailTab, lbl: string) =>
    `<button data-tab="${t}" class="${detailTab === t ? 'active' : ''}">${lbl}</button>`
  const tabs = `<div class="seg detail-tabs">` +
    tabBtn('verlauf', 'Verlauf') + tabBtn('vmax', 'Verteilung Max') +
    tabBtn('vmin', 'Verteilung Min') + tabBtn('kalender', 'Kalender') + `</div>`

  let panel = '<p class="empty">Kein Verlauf verfügbar.</p>'
  sparkCtx = null
  distCtx = null
  if (ser) {
    if (detailTab === 'verlauf') {
      const o = overlayBuild(ser, dates)
      sparkCtx = o.ctx
      panel = o.html + overlayLegend(dates)
    } else if (detailTab === 'vmax' || detailTab === 'vmin') {
      const metric = detailTab === 'vmax' ? 'max' : 'min'
      const o = distBuild(ser, dates, metric)
      distCtx = o.ctx
      panel = o.html + distLegend(dates, metric)
    } else {
      panel = calendarPanel(ser, dates)
    }
  }

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

function overlayBuild(ser: SeriesEntry, dates: string[]): { html: string; ctx: SparkCtx | null } {
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
  if (!vals.length) return { html: '<p class="empty">Kein Verlauf verfügbar.</p>', ctx: null }
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
  const html = `<svg class="spark" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    zero + paths + months + yl + `<g class="spark-guide"></g></svg>`
  return { html, ctx: { byYear, years, lo, hi, W, H, padL, padR, padT, padB } }
}

// Hover über dem Graph: nächsten Tag bestimmen, Führungslinie + Werte je Jahr
function onSparkMove(svg: SVGSVGElement, clientX: number, clientY: number): void {
  const c = sparkCtx
  if (!c) return
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0) return
  const sx = (clientX - rect.left) / rect.width * c.W
  let d = Math.round(1 + ((sx - c.padL) / (c.W - c.padL - c.padR)) * 365)
  d = Math.max(1, Math.min(366, d))
  const gx = c.padL + ((d - 1) / 365) * (c.W - c.padL - c.padR)
  const ys = (v: number) => c.padT + (1 - (v - c.lo) / (c.hi - c.lo)) * (c.H - c.padT - c.padB)
  const curY = c.years[c.years.length - 1]
  let g = `<line class="guide-line" x1="${gx.toFixed(1)}" y1="${c.padT}" x2="${gx.toFixed(1)}" y2="${(c.H - c.padB).toFixed(1)}"/>`
  const rows: string[] = []
  for (const Y of c.years) {
    const o = c.byYear.get(Y)!
    const mx = o.max[d], mn = o.min[d]
    if (mx != null) g += `<circle class="guide-dot mx" cx="${gx.toFixed(1)}" cy="${ys(mx).toFixed(1)}" r="2.5"/>`
    if (mn != null) g += `<circle class="guide-dot mn" cx="${gx.toFixed(1)}" cy="${ys(mn).toFixed(1)}" r="2.5"/>`
    if (mx != null || mn != null)
      rows.push(`<span class="ty${Y === curY ? '' : ' faintlbl'}">${Y}</span> ` +
        `<span class="mx">${mx != null ? mx.toFixed(1) + '°' : '–'}</span> / ` +
        `<span class="mn">${mn != null ? mn.toFixed(1) + '°' : '–'}</span>`)
  }
  const gg = svg.querySelector('.spark-guide')
  if (gg) gg.innerHTML = g
  if (rows.length) {
    const dt = new Date(Date.UTC(curY, 0, d))
    const lbl = `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.`
    showTip(`<b>${lbl}</b><br>${rows.join('<br>')}`, clientX, clientY)
  } else hideTip()
}

function overlayLegend(dates: string[]): string {
  const years = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const curY = years[years.length - 1]
  const yl = years.map((y) => `<span class="${y === curY ? '' : 'faintlbl'}">${y}</span>`).join(' · ')
  return `<div class="spark-legend">${yl} &nbsp; <span class="mx">— Max</span> <span class="mn">— Min</span></div>`
}

// Verteilung: je Jahr ein Häufigkeits-Polygon "Anzahl Tage (y) über Temperatur (x, 1°C-Bins)".
// Bewusst ohne Gates -- gezeigt wird die Rohlage aus series.json (wie der Verlauf).
function distBuild(ser: SeriesEntry, dates: string[], metric: 'max' | 'min'): { html: string; ctx: DistCtx | null } {
  const counts = new Map<number, Map<number, number>>()
  let lo = Infinity, hi = -Infinity
  dates.forEach((ds, i) => {
    const v = ser[metric][i]
    if (v == null) return
    const Y = +ds.slice(0, 4), t = Math.round(v)
    let m = counts.get(Y)
    if (!m) { m = new Map(); counts.set(Y, m) }
    m.set(t, (m.get(t) ?? 0) + 1)
    if (t < lo) lo = t
    if (t > hi) hi = t
  })
  if (!counts.size) return { html: '<p class="empty">Kein Verlauf verfügbar.</p>', ctx: null }
  if (hi - lo < 1) { hi += 1; lo -= 1 }
  // je Jahr auf Anteil der Tage normieren -> Jahre vergleichbar (Teiljahr verzerrt nicht)
  const totals = new Map<number, number>()
  counts.forEach((m, Y) => { let s = 0; m.forEach((c) => { s += c }); totals.set(Y, s) })
  const pct = (Y: number, t: number) => ((counts.get(Y)?.get(t) ?? 0) / (totals.get(Y) || 1)) * 100
  let maxPct = 1
  counts.forEach((m, Y) => m.forEach((_, t) => { const p = pct(Y, t); if (p > maxPct) maxPct = p }))
  const years = [...counts.keys()].sort((a, b) => a - b)
  const curY = years[years.length - 1]
  const W = 540, H = 170, padL = 30, padR = 8, padT = 10, padB = 22
  const xs = (t: number) => padL + ((t - lo) / (hi - lo)) * (W - padL - padR)
  const ys = (p: number) => padT + (1 - p / maxPct) * (H - padT - padB)
  const tone = metric === 'max' ? 'hot' : 'cool'
  let paths = ''
  for (const Y of years) {
    let d = ''
    for (let t = lo; t <= hi; t++) d += `${t === lo ? 'M' : 'L'}${xs(t).toFixed(1)},${ys(pct(Y, t)).toFixed(1)} `
    paths += `<path class="dist-line ${tone}${Y !== curY ? ' faint' : ''}" d="${d.trim()}"/>`
  }
  let xlbl = ''
  for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5)
    xlbl += `<text class="spark-lbl" x="${xs(t).toFixed(1)}" y="${H - 4}" text-anchor="middle">${t}°</text>`
  const ylbl = `<text class="spark-lbl" x="2" y="${(ys(maxPct) + 3).toFixed(1)}">${maxPct.toFixed(0)}%</text>` +
    `<text class="spark-lbl" x="2" y="${(ys(0) + 3).toFixed(1)}">0%</text>`
  const html = `<svg class="dist" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    `<line class="spark-axis" x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${W - padR}" y2="${(H - padB).toFixed(1)}"/>` +
    paths + xlbl + ylbl + `<g class="dist-guide"></g></svg>`
  return { html, ctx: { counts, totals, years, lo, hi, maxPct, metric, W, H, padL, padR, padT, padB } }
}

// Hover über der Verteilung: Temperatur-Bin bestimmen, Führungslinie + "N Tage" je Jahr.
function onDistMove(svg: SVGSVGElement, clientX: number, clientY: number): void {
  const c = distCtx
  if (!c) return
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0) return
  const sx = (clientX - rect.left) / rect.width * c.W
  let t = Math.round(c.lo + ((sx - c.padL) / (c.W - c.padL - c.padR)) * (c.hi - c.lo))
  t = Math.max(c.lo, Math.min(c.hi, t))
  const gx = c.padL + ((t - c.lo) / (c.hi - c.lo)) * (c.W - c.padL - c.padR)
  const ys = (p: number) => c.padT + (1 - p / c.maxPct) * (c.H - c.padT - c.padB)
  const curY = c.years[c.years.length - 1]
  const tone = c.metric === 'max' ? 'mx' : 'mn'
  let g = `<line class="guide-line" x1="${gx.toFixed(1)}" y1="${c.padT}" x2="${gx.toFixed(1)}" y2="${(c.H - c.padB).toFixed(1)}"/>`
  const rows: string[] = []
  for (const Y of c.years) {
    const n = c.counts.get(Y)?.get(t) ?? 0
    const p = (n / (c.totals.get(Y) || 1)) * 100
    g += `<circle class="guide-dot ${tone}" cx="${gx.toFixed(1)}" cy="${ys(p).toFixed(1)}" r="2.5"/>`
    rows.push(`<span class="ty${Y === curY ? '' : ' faintlbl'}">${Y}</span> ` +
      `<span class="${tone}">${p.toFixed(1)} %</span> <span class="dim">${n} ${n === 1 ? 'Tag' : 'Tage'}</span>`)
  }
  const gg = svg.querySelector('.dist-guide')
  if (gg) gg.innerHTML = g
  showTip(`<b>${t}°</b><br>${rows.join('<br>')}`, clientX, clientY)
}

function distLegend(dates: string[], metric: 'max' | 'min'): string {
  const years = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const curY = years[years.length - 1]
  const yl = years.map((y) => `<span class="${y === curY ? '' : 'faintlbl'}">${y}</span>`).join(' · ')
  const what = metric === 'max'
    ? '<span class="mx">— Tagesmaxima</span>' : '<span class="mn">— Tagesminima</span>'
  return `<div class="spark-legend">${yl} &nbsp; ${what} &nbsp; · Anteil der Tage (%) je 1°C</div>`
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
    cells += `<rect class="cal ${cls}" x="${(col * (cell + gap)).toFixed(1)}" y="${(row * (cell + gap)).toFixed(1)}" width="${cell}" height="${cell}" data-d="${fmtDate(ds)}" data-v="${v == null ? '—' : v.toFixed(1) + '°'}"></rect>`
  }
  const W = (maxCol + 1) * (cell + gap), H = 7 * (cell + gap)
  return `<div class="cal-year"><div class="cal-label">${year}</div>` +
    `<svg class="cal-svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="xMinYMin meet">${cells}</svg></div>`
}

function closeDetail(): void { detailEl.hidden = true; detailBody.innerHTML = ''; sparkCtx = null; distCtx = null; hideTip() }

/* ---------- URL-State ---------- */
function readHash(): void {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  const validP: View[] = ['now', 'day', 'week', 'month', 'year']
  if (parts[0] && validP.includes(parts[0] as View)) view = parts[0] as View
  if (parts.includes('min')) metric = 'min'; else if (parts.includes('max')) metric = 'max'
  viewMode = parts.includes('rekorde') ? 'rekorde' : parts.includes('map') ? 'map' : 'table'
  const yr = parts.find((p) => /^\d{4}$/.test(p))
  yearSel = parts.includes('all') ? 'all' : (yr ?? 'current')
  sortDir = metric === 'min' ? 'cold' : 'hot'
}
function writeHash(): void {
  const parts: string[] = [view]
  if (view !== 'now') parts.push(metric)
  if (view === 'year' && yearSel !== 'current') parts.push(yearSel)
  if (viewMode !== 'table') parts.push(viewMode)
  const h = '#' + parts.join('/')
  if (location.hash !== h) history.replaceState(null, '', h)
}
function syncControls(): void {
  for (const b of periodsEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.period === view)
  for (const b of metricEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.metric === metric)
  for (const b of viewEl.querySelectorAll('button'))
    b.classList.toggle('active', (b as HTMLElement).dataset.view === viewMode)
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
  viewMode = b.dataset.view as 'table' | 'map' | 'rekorde'
  syncControls(); writeHash(); render()
})
recordsEl.addEventListener('click', (e) => {
  const yb = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-recyear]')
  if (yb) { recYear = yb.dataset.recyear!; render(); return }
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
  if (card) void openDetail(card.dataset.id!)
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
  detailTab = b.dataset.tab as DetailTab
  renderDetail()
})
detailBody.addEventListener('mousemove', (e) => {
  if (!(e.target instanceof Element)) return
  const cal = e.target.closest('.cal')
  if (cal) { showTip(`<b>${cal.getAttribute('data-d')}</b> · ${cal.getAttribute('data-v')}`, e.clientX, e.clientY); return }
  const svg = e.target.closest('.spark') as SVGSVGElement | null
  if (svg) { onSparkMove(svg, e.clientX, e.clientY); return }
  const dist = e.target.closest('.dist') as SVGSVGElement | null
  if (dist) { onDistMove(dist, e.clientX, e.clientY); return }
  hideTip(); clearGuide()
})
detailBody.addEventListener('mouseleave', () => { hideTip(); clearGuide() })
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
