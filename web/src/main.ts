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
// reference.json: Tages-Klimatologie der Normalperiode (per ./reference.sh erzeugt).
//   max/min: geglättete Normalwerte je Kalendertag (Index 1…366; [0] ungenutzt).
//   histMax/histMin: gepoolte Verteilung der Tageswerte (1-°C-Bins, °C -> Tage).
interface RefEntry { max: (number | null)[]; min: (number | null)[]; histMax: Record<string, number>; histMin: Record<string, number>; y0?: number; y1?: number; ny?: number }
interface Reference { period: string; stations: Record<string, RefEntry> }
// history/<wmo>.json: volle Tageshistorie einer Station (per ./reference.sh --history),
// on-demand geladen. Dichte Tagesreihe ab `start` (Index = Tagesoffset).
interface Hist { start: string; max: (number | null)[]; min: (number | null)[] }
// records.json: Allzeit-Rekord je Station (volles DWD-Archiv), per ./reference.sh
interface RecEntry {
  maxC?: number; maxDate?: string; minC?: number; minDate?: string   // heißester / kältester Tag
  nightC?: number; nightDate?: string                                // wärmste Nacht (max TNK)
  tropLen?: number; tropStart?: string; tropEnd?: string             // längste Tropennacht-Serie (≥20)
  wnightLen?: number; wnightStart?: string; wnightEnd?: string       // längste Wüstennacht-Serie (≥25)
  stropLen?: number; stropStart?: string; stropEnd?: string          // längste Super-Tropennacht-Serie (≥30)
  heatLen?: number; heatStart?: string; heatEnd?: string             // längste Hitzeserie (≥30)
  desertLen?: number; desertStart?: string; desertEnd?: string       // längste Wüstenserie (≥35)
  extremeLen?: number; extremeStart?: string; extremeEnd?: string    // längste Extremserie (≥40)
  glutLen?: number; glutStart?: string; glutEnd?: string             // längste Gluttag-Serie (≥45)
  iceLen?: number; iceStart?: string; iceEnd?: string                // längste Eisserie
  hotDays?: number; hotYear?: number                                 // meiste Hitzetage/Jahr (≥30)
  desertDays?: number; desertYear?: number                           // meiste Wüstentage/Jahr (≥35)
  extremeDays?: number; extremeYear?: number                         // meiste Extremtage/Jahr (≥40)
  glutDays?: number; glutYear?: number                               // meiste Gluttage/Jahr (≥45)
  tropN?: number; tropYear?: number                                  // meiste Tropennächte/Jahr (≥20)
  wnightN?: number; wnightYear?: number                              // meiste Wüstennächte/Jahr (≥25)
  stropN?: number; stropYear?: number                                // meiste Super-Tropennächte/Jahr (≥30)
}
interface NatBest { count: number; year: number }
interface Records {
  records: Record<string, RecEntry>
  national?: {
    hotDaysBest?: NatBest; desertDaysBest?: NatBest; extremeDaysBest?: NatBest; glutDaysBest?: NatBest
    tropBest?: NatBest; wnightBest?: NatBest; stropBest?: NatBest
  }
  names?: Record<string, string>   // Namen reiner Klimastationen (haben keinen coords-Eintrag)
}
// timeline.json: nationale Jahres-Zeitreihe je Metrik (per ./reference.sh) — fürs Rekord-Modal
interface TLMetric {
  kind: 'ext' | 'count'; dir?: 'max' | 'min'
  val?: (number | null)[]; st?: (string | null)[]; dt?: (string | null)[]   // Extremwerte
  all?: number[]                                                             // Zähler
}
interface Timeline { years: number[]; metrics: Record<string, TLMetric>; names?: Record<string, string> }
// annual-mean.json: offizielles DWD-Gebietsmittel der Jahrestemperatur (per ./annual-mean.sh)
interface AnnualMean { years: number[]; mean: (number | null)[]; source?: string }

// Anzeigename einer Station: POI aus coords, reine Klimastationen aus den names-Maps
function stName(id: string): string {
  return coords[id]?.name ?? records?.names?.[id] ?? timeline?.names?.[id] ?? id
}

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
let reference: Reference | null = null
let referencePromise: Promise<void> | null = null
let records: Records | null = null
let recordsPromise: Promise<void> | null = null
let timeline: Timeline | null = null
let timelinePromise: Promise<void> | null = null
let annualMean: AnnualMean | null = null
let annualMeanPromise: Promise<void> | null = null
const historyRaw = new Map<string, Hist | null>()                 // geladene history/<id>.json (null = keine)
const combinedCache = new Map<string, { dates: string[]; ser: SeriesEntry }>()  // Historie + Live je Station

let view: View = 'now'
let metric: Metric = 'max'
let sortDir: SortDir = 'hot'
let viewMode: 'table' | 'map' | 'rekorde' = 'table'
let filter = ''
let yearSel = 'current'              // bei view==='year': 'current' | '<jahr>' | 'all'
let recYear = 'all'                  // Rekorde-Filter: 'all' | '<jahr>'
let detailId: string | null = null
type DetailTab = 'verlauf' | 'vmax' | 'vmin' | 'kalender' | 'rekorde'
let detailTab: DetailTab = 'verlauf'
let recDetailMetric: string | null = null   // im Rekorde-Tab geöffnete Metrik (null = Kartenübersicht)
// je Station: Jahres-Zeitreihe je Rekord-Metrik, aus der kombinierten Tagesreihe berechnet
const stationStatsCache = new Map<string, Record<string, { years: number[]; m: TLMetric }>>()
let calYears: number | 'all' = 2     // Kalender: wie viele (neueste) Jahre zeigen

// series.json (Verlauf je Station) einmalig nachladen
function ensureSeries(): Promise<void> {
  if (!seriesPromise) seriesPromise = fetchJson<Series>('data/series.json').then((s) => { series = s })
  return seriesPromise
}

// reference.json (Normalwerte je Station) einmalig nachladen; optional -> Fehler ok
function ensureReference(): Promise<void> {
  if (!referencePromise) referencePromise = fetchJson<Reference>('data/reference.json').then((r) => { reference = r })
  return referencePromise
}

// records.json (Allzeit-Rekorde je Station) einmalig nachladen
function ensureRecords(): Promise<void> {
  if (!recordsPromise) recordsPromise = fetchJson<Records>('data/records.json').then((r) => { records = r })
  return recordsPromise
}

// timeline.json (nationale Jahres-Zeitreihen) einmalig nachladen
function ensureTimeline(): Promise<void> {
  if (!timelinePromise) timelinePromise = fetchJson<Timeline>('data/timeline.json').then((t) => { timeline = t })
  return timelinePromise
}

// annual-mean.json (nationale Jahresmitteltemperatur) einmalig nachladen; Fehler ok
function ensureAnnualMean(): Promise<void> {
  if (!annualMeanPromise) annualMeanPromise = fetchJson<AnnualMean>('data/annual-mean.json').then((a) => { annualMean = a })
  return annualMeanPromise
}

// history/<id>.json on-demand laden (je Station genau einmal) und mit Live-Reihe mergen
function ensureHistory(id: string): Promise<void> {
  if (historyRaw.has(id)) return Promise.resolve()
  return fetchJson<Hist>(`data/history/${id}.json`).then((h) => {
    historyRaw.set(id, h)
    if (h) buildCombined(id)
  })
}

const DAY_MS = 86400000
function isoUTC(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Historie (DWD-Klimaarchiv) + Live-Reihe (series.json) zu einer Tagesreihe verschmelzen.
// Live gewinnt bei Datums-Überschneidung (das ist die kanonische Reihe der restlichen Seite).
function buildCombined(id: string): void {
  const hist = historyRaw.get(id)
  const live = series?.stations[id]
  const liveDates = series?.dates ?? []
  if (!hist) return
  const map = new Map<string, [number | null, number | null]>()
  const t0 = Date.parse(hist.start + 'T00:00:00Z')
  for (let i = 0; i < hist.max.length; i++) {
    const mx = hist.max[i], mn = hist.min[i]
    if (mx == null && mn == null) continue
    map.set(isoUTC(t0 + i * DAY_MS), [mx, mn])
  }
  // Live-Reihe nur bei echten POI-Stationen einmischen; reine Klimastationen bleiben
  // reines Archiv (sonst hinge der aktuelle, leere Live-Jahrgang als Null-Schwanz an).
  if (live) liveDates.forEach((ds, i) => { map.set(ds, [live.max[i], live.min[i]]) })
  const dates = [...map.keys()].sort()
  const ser: SeriesEntry = { max: dates.map((d) => map.get(d)![0]), min: dates.map((d) => map.get(d)![1]) }
  combinedCache.set(id, { dates, ser })
  stationStatsCache.delete(id)   // Rekord-Zeitreihen mit voller Historie neu berechnen
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
  // Jahr-Sub-Auswahl -> client-seitig: einzelne Jahre aus series.json,
  // „Allzeit" = Rekord je Station aus records.json (volles Archiv) + Live-Reihe.
  if (view === 'year' && yearSel !== 'current') {
    const what = metric === 'max' ? 'Höchstwerte' : 'Tiefstwerte'
    if (yearSel === 'all') {
      if (!series || !records) return null
      const items = computeAllTimeItems()
      return { items, metaHtml: `${what} <strong>Allzeit</strong> · Rekord je Station seit Aufzeichnungsbeginn · ${items.length} Stationen` }
    }
    if (!series) return null
    const { items, hidden } = computeYearItems(+yearSel)
    return { items, metaHtml: `${what} <strong>${yearSel}</strong> · ${items.length} Stationen${hideNote(hidden)}` }
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

// Bestwerte je Station aus der Live-Reihe (series.json, 2025+); einmal berechnet.
let liveExtCache: Map<string, { mx: number | null; mxd: string; mn: number | null; mnd: string }> | null = null
function liveExtremes(): Map<string, { mx: number | null; mxd: string; mn: number | null; mnd: string }> {
  if (liveExtCache) return liveExtCache
  const m = new Map<string, { mx: number | null; mxd: string; mn: number | null; mnd: string }>()
  if (series) {
    const { dates, stations } = series
    for (const id in stations) {
      const s = stations[id]
      let mx: number | null = null, mxd = '', mn: number | null = null, mnd = ''
      for (let i = 0; i < dates.length; i++) {
        const a = s.max[i], b = s.min[i]
        if (a != null && (mx === null || a > mx)) { mx = a; mxd = dates[i] }
        if (b != null && (mn === null || b < mn)) { mn = b; mnd = dates[i] }
      }
      m.set(id, { mx, mxd, mn, mnd })
    }
  }
  liveExtCache = m
  return m
}

// Allzeit-Rangliste: Rekord je Station aus records.json (volles Archiv), mit der
// Live-Reihe gemerged (damit auch 2026er-Rekorde zählen). Kein Abdeckungs-Gate.
function computeAllTimeItems(): Item[] {
  if (!records) return []
  const live = liveExtremes()
  const items: Item[] = []
  const ids = new Set<string>([...Object.keys(records.records), ...live.keys()])
  for (const id of ids) {
    const rec = records.records[id], lv = live.get(id)
    let v: number | null = null, obs = ''
    if (metric === 'max') {
      if (rec?.maxC != null) { v = rec.maxC; obs = rec.maxDate ?? '' }
      if (lv?.mx != null && (v === null || lv.mx > v)) { v = lv.mx; obs = lv.mxd }
    } else {
      if (rec?.minC != null) { v = rec.minC; obs = rec.minDate ?? '' }
      if (lv?.mn != null && (v === null || lv.mn < v)) { v = lv.mn; obs = lv.mnd }
    }
    if (v == null) continue
    items.push({ id, name: stName(id), value: v, obs })
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

/* ---------- Rekorde-Tafel (aus series.json) ---------- */
type RecResult = { id: string; name: string; valueText: string; sub: string; cls: string; v?: number }

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
  return { id: best.id, name: best.name, v: best.v, valueText: `${best.v.toFixed(1)}°`, sub: `${best.name} · ${fmtDate(best.date)}`, cls: tempClass(best.v) }
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
  return { id: best.id, name: best.name, v: best.v, valueText: `${best.v.toFixed(1)}°`, sub: `${best.name} · ${fmtDate(best.date)}`, cls: tempClass(best.v) }
}

function recStreak(yr: number | null, thr: number, key: 'max' | 'min', above: boolean, unit: string): RecResult | null {
  if (!series) return null
  const { dates, stations } = series
  let best: { id: string; name: string; len: number; start: string; end: string } | null = null
  for (const id in stations) {
    const arr = key === 'max' ? stations[id].max : stations[id].min
    let run = 0, startIdx = -1
    for (let i = 0; i < dates.length; i++) {
      if (yr !== null && +dates[i].slice(0, 4) !== yr) { run = 0; continue }
      const v = arr[i]
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
  return { id: best.id, name: best.name, v: best.len, valueText: `${best.len} ${unit}`, sub: `${best.name} · ${fmtDate(best.start)}–${fmtDate(best.end)}`, cls: '' }
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
  return { id: best.id, name: best.name, v: best.count, valueText: `${best.count} ${unit}`, sub: `${best.name} · ${best.year}`, cls: '' }
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

/* ---- Allzeit-Rekorde aus records.json (Archiv) — für das „Gesamt"-Tab ---- */
const recNm = (id: string) => stName(id)
// beste Station nach einem Feld; baut daraus eine RecResult
function atBest(sel: (e: RecEntry) => number | undefined, higher: boolean,
                build: (id: string, e: RecEntry, v: number) => RecResult): RecResult | null {
  if (!records) return null
  let best: { id: string; e: RecEntry; v: number } | null = null
  for (const id in records.records) {
    const e = records.records[id], v = sel(e)
    if (v == null) continue
    if (!best || (higher ? v > best.v : v < best.v)) best = { id, e, v }
  }
  return best ? build(best.id, best.e, best.v) : null
}
const atHottest = () => atBest((e) => e.maxC, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v.toFixed(1)}°`, sub: `${recNm(id)} · ${fmtDate(e.maxDate!)}`, cls: tempClass(v) }))
const atColdest = () => atBest((e) => e.minC, false, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v.toFixed(1)}°`, sub: `${recNm(id)} · ${fmtDate(e.minDate!)}`, cls: tempClass(v) }))
const atNight = () => atBest((e) => e.nightC, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v.toFixed(1)}°`, sub: `${recNm(id)} · ${fmtDate(e.nightDate!)}`, cls: tempClass(v) }))
const atTropStreak = () => atBest((e) => e.tropLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${fmtDate(e.tropStart!)}–${fmtDate(e.tropEnd!)}`, cls: '' }))
const atWnightStreak = () => atBest((e) => e.wnightLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${fmtDate(e.wnightStart!)}–${fmtDate(e.wnightEnd!)}`, cls: '' }))
const atStropStreak = () => atBest((e) => e.stropLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${fmtDate(e.stropStart!)}–${fmtDate(e.stropEnd!)}`, cls: '' }))
const atHeat = () => atBest((e) => e.heatLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${fmtDate(e.heatStart!)}–${fmtDate(e.heatEnd!)}`, cls: '' }))
const atIce = () => atBest((e) => e.iceLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${fmtDate(e.iceStart!)}–${fmtDate(e.iceEnd!)}`, cls: '' }))
const atMostHot = () => atBest((e) => e.hotDays, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${e.hotYear}`, cls: '' }))
const atMostTrop = () => atBest((e) => e.tropN, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${e.tropYear}`, cls: '' }))
const atMostWnight = () => atBest((e) => e.wnightN, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${e.wnightYear}`, cls: '' }))
const atMostStrop = () => atBest((e) => e.stropN, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Nächte`, sub: `${recNm(id)} · ${e.stropYear}`, cls: '' }))
const atDesertStreak = () => atBest((e) => e.desertLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${fmtDate(e.desertStart!)}–${fmtDate(e.desertEnd!)}`, cls: '' }))
const atMostDesert = () => atBest((e) => e.desertDays, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${e.desertYear}`, cls: '' }))
const atExtremeStreak = () => atBest((e) => e.extremeLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${fmtDate(e.extremeStart!)}–${fmtDate(e.extremeEnd!)}`, cls: '' }))
const atMostExtreme = () => atBest((e) => e.extremeDays, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${e.extremeYear}`, cls: '' }))
const atGlutStreak = () => atBest((e) => e.glutLen, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${fmtDate(e.glutStart!)}–${fmtDate(e.glutEnd!)}`, cls: '' }))
const atMostGlut = () => atBest((e) => e.glutDays, true, (id, e, v) => ({ id, name: recNm(id), v, valueText: `${v} Tage`, sub: `${recNm(id)} · ${e.glutYear}`, cls: '' }))

// besseren der beiden Rekorde wählen (Serie/Live vs. Archiv)
function betterRec(a: RecResult | null, b: RecResult | null, higher = true): RecResult | null {
  if (!a) return b
  if (!b) return a
  const av = a.v ?? -Infinity, bv = b.v ?? -Infinity
  return (higher ? av >= bv : av <= bv) ? a : b
}
// nationale Kennzahl (bestes Einzeljahr): Serie vs. Archiv
function betterNat(a: { count: number; year: string }, b?: NatBest): { count: number; year: string } {
  return b && b.count > a.count ? { count: b.count, year: String(b.year) } : a
}

// rec = Datensatz; metric gesetzt -> Klick öffnet Rekord-Zeitverlauf, sonst die Station
function recCard(icon: string, label: string, rec: RecResult | null, note?: string, metric?: string): string {
  const head = `<span class="rec-ico">${icon}</span><span class="rec-k">${label}${note ? ` <span class="rec-note">${note}</span>` : ''}</span>`
  if (!rec) return `<div class="rec-card is-empty">${head}<span class="rec-sub">keine Daten</span></div>`
  const attr = metric ? `data-rec="${metric}"` : `data-id="${rec.id}"`
  return `<button type="button" class="rec-card" ${attr}>${head}` +
    `<span class="rec-v ${rec.cls}">${rec.valueText}</span>` +
    `<span class="rec-sub">${esc(rec.sub)}</span></button>`
}

// nationale Kennzahl; metric gesetzt -> klickbar (Rekord-Zeitverlauf), sonst statisch
function statCard(icon: string, label: string, valueText: string, sub: string, metric?: string): string {
  const inner = `<span class="rec-ico">${icon}</span>` +
    `<span class="rec-k">${label}</span><span class="rec-v">${valueText}</span><span class="rec-sub">${esc(sub)}</span>`
  return metric
    ? `<button type="button" class="rec-card is-stat lnk" data-rec="${metric}">${inner}</button>`
    : `<div class="rec-card is-stat">${inner}</div>`
}

// Zähl-/Serien-Karte: metric gesetzt -> Klick öffnet den Rekord-Zeitverlauf
function countCard(icon: string, label: string, rec: RecResult | null, unit: string, note?: string, metric?: string): string {
  if (rec) return recCard(icon, label, rec, note, metric)
  const k = `${label}${note ? ` <span class="rec-note">${note}</span>` : ''}`
  return statCard(icon, k, `0 ${unit}`, 'noch nie', metric)
}

/* ---------- Rekord über die Zeit (Modal aus timeline.json) ---------- */
const REC_METRICS: Record<string, { title: string; unit: string; thr?: string }> = {
  maxTemp: { title: 'Höchste Temperatur', unit: '°' },
  minTemp: { title: 'Tiefste Temperatur', unit: '°' },
  warmNight: { title: 'Wärmste Nacht', unit: '°' },
  hotDays: { title: 'Hitzetage', unit: 'Tage', thr: '≥ 30 °C' },
  desertDays: { title: 'Wüstentage', unit: 'Tage', thr: '≥ 35 °C' },
  extremeDays: { title: 'Extreme Hitze', unit: 'Tage', thr: '≥ 40 °C' },
  glutDays: { title: 'Gluttage', unit: 'Tage', thr: '≥ 45 °C' },
  tropN: { title: 'Tropennächte', unit: 'Nächte', thr: '≥ 20 °C' },
  wnightN: { title: 'Wüstennächte', unit: 'Nächte', thr: '≥ 25 °C' },
  stropN: { title: 'Super-Tropennächte', unit: 'Nächte', thr: '≥ 30 °C' },
  // „Meiste X" — Höchstwert einer Station pro Jahr (national)
  hotDaysMax: { title: 'Meiste Hitzetage', unit: 'Tage', thr: '≥ 30 °C · Bestwert einer Station' },
  desertDaysMax: { title: 'Meiste Wüstentage', unit: 'Tage', thr: '≥ 35 °C · Bestwert einer Station' },
  extremeDaysMax: { title: 'Meiste Extremtage', unit: 'Tage', thr: '≥ 40 °C · Bestwert einer Station' },
  glutDaysMax: { title: 'Meiste Gluttage', unit: 'Tage', thr: '≥ 45 °C · Bestwert einer Station' },
  tropNMax: { title: 'Meiste Tropennächte', unit: 'Nächte', thr: '≥ 20 °C · Bestwert einer Station' },
  wnightNMax: { title: 'Meiste Wüstennächte', unit: 'Nächte', thr: '≥ 25 °C · Bestwert einer Station' },
  stropNMax: { title: 'Meiste Super-Tropennächte', unit: 'Nächte', thr: '≥ 30 °C · Bestwert einer Station' },
  // „Längste Serie" — längste Serie irgendeiner Station pro Jahr (national)
  hotStreak: { title: 'Längste Hitzeserie', unit: 'Tage', thr: '≥ 30 °C' },
  desertStreak: { title: 'Längste Wüstenserie', unit: 'Tage', thr: '≥ 35 °C' },
  extremeStreak: { title: 'Längste Extremserie', unit: 'Tage', thr: '≥ 40 °C' },
  glutStreak: { title: 'Längste Gluttag-Serie', unit: 'Tage', thr: '≥ 45 °C' },
  tropStreak: { title: 'Längste Tropennacht-Serie', unit: 'Nächte', thr: '≥ 20 °C' },
  wnightStreak: { title: 'Längste Wüstennacht-Serie', unit: 'Nächte', thr: '≥ 25 °C' },
  stropStreak: { title: 'Längste Super-Tropennacht-Serie', unit: 'Nächte', thr: '≥ 30 °C' },
}

// Konfiguration zur Berechnung des aktuellen (Live-)Jahres aus series.json je Metrik
const REC_LIVE: Record<string, { arr: 'max' | 'min'; thr: number; agg: 'distinct' | 'maxcount' | 'maxrun' | 'extmax' | 'extmin' }> = {
  maxTemp: { arr: 'max', thr: 0, agg: 'extmax' }, minTemp: { arr: 'min', thr: 0, agg: 'extmin' }, warmNight: { arr: 'min', thr: 0, agg: 'extmax' },
  hotDays: { arr: 'max', thr: 30, agg: 'distinct' }, desertDays: { arr: 'max', thr: 35, agg: 'distinct' }, extremeDays: { arr: 'max', thr: 40, agg: 'distinct' }, glutDays: { arr: 'max', thr: 45, agg: 'distinct' },
  tropN: { arr: 'min', thr: 20, agg: 'distinct' }, wnightN: { arr: 'min', thr: 25, agg: 'distinct' }, stropN: { arr: 'min', thr: 30, agg: 'distinct' },
  hotDaysMax: { arr: 'max', thr: 30, agg: 'maxcount' }, desertDaysMax: { arr: 'max', thr: 35, agg: 'maxcount' }, extremeDaysMax: { arr: 'max', thr: 40, agg: 'maxcount' }, glutDaysMax: { arr: 'max', thr: 45, agg: 'maxcount' },
  tropNMax: { arr: 'min', thr: 20, agg: 'maxcount' }, wnightNMax: { arr: 'min', thr: 25, agg: 'maxcount' }, stropNMax: { arr: 'min', thr: 30, agg: 'maxcount' },
  hotStreak: { arr: 'max', thr: 30, agg: 'maxrun' }, desertStreak: { arr: 'max', thr: 35, agg: 'maxrun' }, extremeStreak: { arr: 'max', thr: 40, agg: 'maxrun' }, glutStreak: { arr: 'max', thr: 45, agg: 'maxrun' },
  tropStreak: { arr: 'min', thr: 20, agg: 'maxrun' }, wnightStreak: { arr: 'min', thr: 25, agg: 'maxrun' }, stropStreak: { arr: 'min', thr: 30, agg: 'maxrun' },
}

// nationaler Wert eines Jahres aus der Live-Reihe (series.json) — inkl. Station/Datum, fürs laufende Jahr
function liveNational(key: string, year: number): { v: number | null; st: string | null; dt: string | null } {
  const c = REC_LIVE[key]
  if (!c || !series) return { v: null, st: null, dt: null }
  const { dates, stations } = series
  if (c.agg === 'distinct') return { v: distinctEventDays(year, c.thr, c.arr), st: null, dt: null }
  if (c.agg === 'extmax' || c.agg === 'extmin') {
    let bv: number | null = null, bst: string | null = null, bdt: string | null = null
    for (const id in stations) {
      const a = stations[id][c.arr]
      for (let i = 0; i < dates.length; i++) {
        if (+dates[i].slice(0, 4) !== year) continue
        const v = a[i]; if (v == null) continue
        if (bv === null || (c.agg === 'extmax' ? v > bv : v < bv)) { bv = v; bst = id; bdt = dates[i] }
      }
    }
    return { v: bv, st: bst, dt: bdt }
  }
  // maxcount / maxrun: Bestwert über die Stationen (+ verantwortliche Station)
  let best = 0, bst: string | null = null
  for (const id in stations) {
    const a = stations[id][c.arr]
    let cnt = 0, run = 0, stationBest = 0
    for (let i = 0; i < dates.length; i++) {
      if (+dates[i].slice(0, 4) !== year) { run = 0; continue }
      const ok = a[i] != null && a[i]! >= c.thr
      if (ok) { cnt++; run++; if (run > stationBest) stationBest = run } else run = 0
    }
    const sv = c.agg === 'maxrun' ? stationBest : cnt
    if (sv > best) { best = sv; bst = id }
  }
  return { v: best, st: bst, dt: null }
}

// Timeline-Metrik + laufendes Jahr (aus series.json) zusammenführen
function mergedMetric(key: string): { years: number[]; m: TLMetric } {
  const t = timeline!, base = t.metrics[key]
  const liveY = [...new Set((series?.dates ?? []).map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const extra = liveY.filter((y) => y > t.years[t.years.length - 1])
  if (!extra.length) return { years: t.years, m: base }
  const years = [...t.years, ...extra]
  const live = extra.map((y) => liveNational(key, y))
  if (base.kind === 'ext' && base.val) {
    return {
      years, m: {
        ...base, val: [...base.val, ...live.map((r) => r.v)],
        st: base.st ? [...base.st, ...live.map((r) => r.st)] : undefined,
        dt: base.dt ? [...base.dt, ...live.map((r) => r.dt)] : undefined,
      },
    }
  }
  return {
    years, m: {
      ...base, all: [...(base.all ?? []), ...live.map((r) => r.v ?? 0)],
      st: base.st ? [...base.st, ...live.map((r) => r.st)] : undefined,
    },
  }
}

type RecCtx = {
  years: number[]; val: (number | null)[]; st: (string | null)[] | null; dt: (string | null)[] | null
  unit: string; lo: number; hi: number; W: number; H: number; padL: number; padR: number; padT: number; padB: number
  trend: { slope: number; intercept: number } | null; avg: (number | null)[] | null
}
let recCtx: RecCtx | null = null
let meanCtx: RecCtx | null = null   // Hover-Kontext der Jahresmittel-Karte auf der Rekorde-Seite

async function openRecord(key: string): Promise<void> {
  detailId = null
  recCtx = null
  detailEl.hidden = false
  detailBody.innerHTML = '<p class="empty">lädt …</p>'
  await ensureTimeline()
  renderRecord(key)
}

// Hover über dem Rekord-Chart: nächstes Jahr bestimmen, Führungslinie + Tooltip (Wert · Station · Datum)
function onRecordMove(svg: SVGSVGElement, clientX: number, clientY: number, c: RecCtx | null): void {
  if (!c) return
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0) return
  const n = c.years.length
  const sx = (clientX - rect.left) / rect.width * c.W
  let i = Math.round(((sx - c.padL) / (c.W - c.padL - c.padR)) * (n - 1))
  i = Math.max(0, Math.min(n - 1, i))
  const gx = c.padL + (n < 2 ? 0 : (i / (n - 1)) * (c.W - c.padL - c.padR))
  const ys = (v: number) => c.padT + (1 - (v - c.lo) / (c.hi - c.lo)) * (c.H - c.padT - c.padB)
  let g = `<line class="guide-line" x1="${gx.toFixed(1)}" y1="${c.padT}" x2="${gx.toFixed(1)}" y2="${(c.H - c.padB).toFixed(1)}"/>`
  const inRange = (x: number) => x >= c.lo && x <= c.hi
  const fmtC = (x: number) => (c.unit === '°' ? x.toFixed(1).replace('.', ',') + '°' : `${x.toFixed(1).replace('.', ',')} ${c.unit}`)
  const v = c.val[i]
  const rows: string[] = []
  if (v == null) {
    rows.push('keine Daten')
  } else {
    g += `<circle class="guide-dot mx" cx="${gx.toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3"/>`
    rows.push(c.unit === '°' ? v.toFixed(1).replace('.', ',') + '°' : `${v} ${c.unit}`)
  }
  // Trendwert (über die volle Spanne definiert) und gleitendes 30-J.-Mittel (nur wo berechnet)
  if (c.trend) {
    const tv = c.trend.intercept + c.trend.slope * c.years[i]
    if (inRange(tv)) g += `<circle class="guide-dot trend" cx="${gx.toFixed(1)}" cy="${ys(tv).toFixed(1)}" r="3"/>`
    rows.push(`<span class="trendlbl">Trend ${fmtC(tv)}</span>`)
  }
  const av = c.avg?.[i]
  if (av != null) {
    g += `<circle class="guide-dot avg" cx="${gx.toFixed(1)}" cy="${ys(av).toFixed(1)}" r="3"/>`
    rows.push(`<span class="reflbl">30-J.-Mittel ${fmtC(av)}</span>`)
  }
  if (v != null) {
    const stId = c.st?.[i]
    const date = c.dt?.[i] ? fmtDate(c.dt[i]!) : ''
    const extra = [stId ? stName(stId) : '', date].filter(Boolean).join(' · ')
    if (extra) rows.push(`<span class="dim">${esc(extra)}</span>`)
  }
  const tip = `<b>${c.years[i]}</b><br>${rows.join('<br>')}`
  const gg = svg.querySelector('.recc-guide')
  if (gg) gg.innerHTML = g
  showTip(tip, clientX, clientY)
}

function renderRecord(key: string): void {
  const meta = REC_METRICS[key]
  if (!meta || !timeline?.metrics[key]) { detailBody.innerHTML = '<p class="empty">Keine Zeitreihe verfügbar.</p>'; return }
  const { years, m } = mergedMetric(key)
  const fmtV = (v: number) => (meta.unit === '°' ? v.toFixed(1).replace('.', ',') + '°' : `${v} ${meta.unit}`)
  let headVal = '—', headSub = '', cls = key === 'minTemp' ? 'cool' : (meta.unit === '°' ? 'hot' : '')
  if (m.kind === 'ext' && m.val) {
    let bi = -1, bv = m.dir === 'min' ? Infinity : -Infinity
    m.val.forEach((v, i) => { if (v != null && (m.dir === 'min' ? v < bv : v > bv)) { bv = v; bi = i } })
    if (bi >= 0) { headVal = fmtV(bv); const st = m.st?.[bi]; headSub = `${st ? stName(st) : ''} · ${m.dt?.[bi] ? fmtDate(m.dt[bi]!) : years[bi]}` }
  } else if (m.all) {
    let bi = 0; m.all.forEach((v, i) => { if (v > m.all![bi]) bi = i })
    headVal = fmtV(m.all[bi]); headSub = `Rekordjahr ${years[bi]}`
  }
  const chart = recordChart(key, years, m)
  recCtx = chart.ctx
  detailBody.innerHTML =
    `<h2>${meta.title}${meta.thr ? `<span class="detail-badge">${meta.thr}</span>` : ''}</h2>` +
    `<div class="detail-sub">Deutschland · über die Zeit</div>` +
    `<div class="facts"><div class="fact"><div class="k">Rekord</div><div class="v ${cls}">${headVal}</div>` +
    `<div class="k">${esc(headSub)}</div></div></div>` +
    `<div class="detail-panel">${chart.html}</div>`
}

// Metriken, für die eine Trendlinie sinnvoll ist: dicht besetzt (fast alle Jahre seit 1936)
// und aussagekräftig. Bewusst ausgeschlossen (zu selten/nie in Deutschland, s. Diskussion):
// Extremtage ≥ 40 °C, Gluttage ≥ 45 °C, Wüsten- (≥ 25 °C) und Super-Tropennächte (≥ 30 °C).
const REC_TREND = new Set([
  'maxTemp', 'minTemp', 'warmNight',
  'hotStreak', 'desertDays', 'desertStreak',
  'tropN', 'tropNMax', 'tropStreak',
])

// Theil-Sen-Trend über (Jahr, Wert)-Punkte: Median der paarweisen Steigungen — robust gegen
// Ausreißer, ohne Verteilungsannahme (passt zu den schiefen Zähl-/Extremreihen).
function theilSen(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  if (pts.length < 3) return null
  const med = (a: number[]): number => {
    const s = [...a].sort((p, q) => p - q), h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
  }
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (pts[j].x !== pts[i].x) slopes.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x))
  if (!slopes.length) return null
  const slope = med(slopes)
  return { slope, intercept: med(pts.map((p) => p.y - slope * p.x)) }
}

// Trendlinie (Theil-Sen) + Legendentext für eine Reihe; null wenn nicht erlaubt oder zu dünn.
// vals sind die Jahreswerte (bei Extremen der Tageswert je Jahr, nicht der Rekord-Umriss).
function trendLayer(
  years: number[], vals: (number | null)[], unit: string,
  xs: (i: number) => number, ys: (v: number) => number, lo: number, hi: number, allow: boolean,
): { path: string; legend: string; fit: { slope: number; intercept: number } } | null {
  if (!allow) return null
  const pts = years
    .map((y, i) => ({ x: y, y: vals[i], i }))
    .filter((p): p is { x: number; y: number; i: number } => p.y != null)
  if (pts.length < 3) return null
  const fit = theilSen(pts.map((p) => ({ x: p.x, y: p.y })))
  if (!fit || fit.slope === 0) return null
  // Endpunkte über die volle Datenspanne; Index ∝ Jahr (lückenlose Reihe) → Gerade bleibt gerade.
  const i0 = pts[0].i, i1 = pts[pts.length - 1].i
  let v0 = fit.intercept + fit.slope * pts[0].x
  let v1 = fit.intercept + fit.slope * pts[pts.length - 1].x
  // Segment auf den sichtbaren Wertebereich [lo,hi] klippen (t entlang i0→i1).
  const dv = v1 - v0
  let t0 = 0, t1 = 1
  if (dv === 0) { if (v0 < lo || v0 > hi) return null }
  else {
    const tl = (lo - v0) / dv, th = (hi - v0) / dv
    t0 = Math.max(t0, Math.min(tl, th))
    t1 = Math.min(t1, Math.max(tl, th))
  }
  if (t0 >= t1) return null
  const lerp = (t: number) => ({ i: i0 + t * (i1 - i0), v: v0 + t * dv })
  const a = lerp(t0), b = lerp(t1)
  const path = `<line class="recc-trend" x1="${xs(a.i).toFixed(1)}" y1="${ys(a.v).toFixed(1)}" ` +
    `x2="${xs(b.i).toFixed(1)}" y2="${ys(b.v).toFixed(1)}"/>`
  const per10 = fit.slope * 10
  const mag = Math.abs(per10).toFixed(1).replace('.', ',')
  const val = unit === '°' ? `${mag}°` : `${mag} ${unit}`
  const legend = `<span class="recc-trend-i">╌ Trend ${per10 >= 0 ? '+' : '−'}${val}/Jahrzehnt</span>`
  return { path, legend, fit }
}

// Gleitender 30-Jahres-Mittelwert (zentriert, Fenster [i-15 … i+14]). Zeigt den geglätteten
// Verlauf/die Dekadenstruktur neben der linearen Trendlinie. Randpunkte brauchen ≥ 20 der 30
// Jahre — der zentrierte Schnitt endet daher bewusst ~4 Jahre vor dem aktuellen Rand (ein
// zentriertes Mittel am letzten Jahr gäbe es sonst nur als verzerrtes Trailing-Mittel).
function movingAvgLayer(
  years: number[], vals: (number | null)[],
  xs: (i: number) => number, ys: (v: number) => number, lo: number, hi: number, allow: boolean,
): { path: string; legend: string; values: (number | null)[] } | null {
  if (!allow) return null
  const before = 15, after = 14, minN = 20
  const clamp = (v: number) => Math.max(lo, Math.min(hi, v))
  const values: (number | null)[] = years.map(() => null)
  const pts: { i: number; v: number }[] = []
  for (let i = 0; i < years.length; i++) {
    let s = 0, c = 0
    for (let j = Math.max(0, i - before); j <= Math.min(years.length - 1, i + after); j++) {
      const v = vals[j]; if (v == null) continue
      s += v; c++
    }
    if (c >= minN) { values[i] = s / c; pts.push({ i, v: s / c }) }
  }
  if (pts.length < 2) return null
  const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${xs(p.i).toFixed(1)},${ys(clamp(p.v)).toFixed(1)}`).join(' ')
  return { path: `<path class="recc-avg" d="${d}"/>`, legend: `<span class="recc-avg-i">⎯ 30-J.-Mittel</span>`, values }
}

function recordChart(key: string, years: number[], m: TLMetric, local = false): { html: string; ctx: RecCtx } {
  const n = years.length, meta = REC_METRICS[key]
  const W = 520, H = 200, padL = 30, padR = 12, padT = 16, padB = 22
  const xs = (i: number) => padL + (n < 2 ? 0 : (i / (n - 1)) * (W - padL - padR))
  const anchorFor = (x: number) => (x > W - padR - 30 ? 'end' : x < padL + 30 ? 'start' : 'middle')
  let lo = 0, hi = 1
  const ys = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  let body = '', yl = '', legendSegs: string[] = []
  const vals = (m.kind === 'ext' ? m.val : m.all) ?? []
  if (m.kind === 'ext' && m.val) {
    const dir = m.dir
    const nums = m.val.filter((v): v is number => v != null)
    lo = Math.min(...nums); hi = Math.max(...nums); if (hi - lo < 2) { hi += 1; lo -= 1 }
    let best = dir === 'min' ? Infinity : -Infinity
    const rec = m.val.map((v) => { if (v != null) best = dir === 'min' ? Math.min(best, v) : Math.max(best, v); return isFinite(best) ? best : null })
    let dots = ''
    m.val.forEach((v, i) => { if (v != null) dots += `<circle class="recc-dot" cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="1.8"/>` })
    let d = '', pen = false, mk = '', lastLblX = -99
    rec.forEach((v, i) => {
      if (v == null) return
      const x = xs(i), y = ys(v)
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `; pen = true
      if (i > 0 && rec[i - 1] != null && v !== rec[i - 1]) {
        mk += `<circle class="recc-mk" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`
        if (x - lastLblX > 52) {
          mk += `<text class="recc-lbl" x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="${anchorFor(x)}">${v.toFixed(1).replace('.', ',')}° ${years[i]}</text>`
          lastLblX = x
        }
      }
    })
    yl = `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi.toFixed(0)}°</text>` +
      `<text class="spark-lbl" x="2" y="${(ys(lo) + 3).toFixed(1)}">${lo.toFixed(0)}°</text>`
    body = dots + `<path class="recc-rec ${dir === 'min' ? 'cool' : ''}" d="${d.trim()}"/>` + mk
    legendSegs = ['<span class="recc-lbl-i">— Rekordverlauf</span>', 'Punkte = heißester/kältester Tag je Jahr']
    if (!local) legendSegs.push('bundesweit')
  } else if (m.all) {
    hi = Math.max(...m.all, 1); lo = 0
    let d = ''
    m.all.forEach((v, i) => { d += `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)} ` })
    let bi = 0; m.all.forEach((v, i) => { if (v > m.all![bi]) bi = i })
    const bx = xs(bi)
    const mk = `<circle class="recc-mk" cx="${bx.toFixed(1)}" cy="${ys(m.all[bi]).toFixed(1)}" r="3"/>` +
      `<text class="recc-lbl" x="${bx.toFixed(1)}" y="${(ys(m.all[bi]) - 7).toFixed(1)}" text-anchor="${anchorFor(bx)}">${m.all[bi]} · ${years[bi]}</text>`
    yl = `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi}</text>` +
      `<text class="spark-lbl" x="2" y="${(ys(0) + 3).toFixed(1)}">0</text>`
    body = `<path class="recc-line" d="${d.trim()}"/>` + mk
    legendSegs = [`${meta.title} pro Jahr`]
    if (!local) legendSegs.push('bundesweit')
    legendSegs.push('Rekordjahr markiert')
    if (!local) legendSegs.push('<span class="dim">Punkt für Details</span>')
  }
  // Overlays: gleitendes Mittel zuerst (darunter), dann die Trendlinie darüber.
  // National: nur die kuratierte Whitelist; lokal (Station): alle Metriken, Guards entscheiden.
  const allow = local || REC_TREND.has(key)
  const avg = movingAvgLayer(years, vals, xs, ys, lo, hi, allow)
  const trend = trendLayer(years, vals, meta.unit, xs, ys, lo, hi, allow)
  for (const o of [avg, trend]) if (o) { body += o.path; legendSegs.push(o.legend) }
  // Legende als Flex-Segmente: Umbrüche nur zwischen „·"-Segmenten, nie mitten in „Trend +x".
  const cap = `<div class="spark-legend recc-legend">${legendSegs.map((s) => `<span>${s}</span>`).join('')}</div>`
  let months = ''
  years.forEach((y, i) => { if (y % 20 === 0) months += `<text class="spark-lbl" x="${xs(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${y}</text>` })
  const svg = `<svg class="recc" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    `<line class="spark-axis" x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${W - padR}" y2="${(H - padB).toFixed(1)}"/>` +
    body + months + yl + `<g class="recc-guide"></g></svg>`
  const ctx: RecCtx = { years, val: vals, st: m.st ?? null, dt: m.dt ?? null, unit: meta.unit, lo, hi, W, H, padL, padR, padT, padB, trend: trend?.fit ?? null, avg: avg?.values ?? null }
  return { html: svg + cap, ctx }
}

// Jahresmitteltemperatur Deutschlands über die Zeit — schlichte Linie + Trend + 30-J.-Mittel.
// Volle Breite, permanent oben auf der Rekorde-Seite. Datengrundlage: annual-mean.json.
function meanChart(am: AnnualMean): { html: string; ctx: RecCtx } {
  const years = am.years, vals = am.mean, n = years.length
  const W = 900, H = 240, padL = 34, padR = 14, padT = 16, padB = 24
  const xs = (i: number) => padL + (n < 2 ? 0 : (i / (n - 1)) * (W - padL - padR))
  const nums = vals.filter((v): v is number => v != null)
  let lo = Math.min(...nums), hi = Math.max(...nums)
  const padv = Math.max(0.4, (hi - lo) * 0.08); lo -= padv; hi += padv
  const ys = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  let d = '', pen = false, dots = ''
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return }
    const x = xs(i), y = ys(v)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `; pen = true
    dots += `<circle class="recc-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/>`
  })
  let body = dots + `<path class="recc-line" d="${d.trim()}"/>`
  const avg = movingAvgLayer(years, vals, xs, ys, lo, hi, true)
  const trend = trendLayer(years, vals, '°', xs, ys, lo, hi, true)
  const segs = ['<span class="recc-lbl-i">— Jahresmittel</span>']
  for (const o of [avg, trend]) if (o) { body += o.path; segs.push(o.legend) }
  const cap = `<div class="spark-legend recc-legend">${segs.map((s) => `<span>${s}</span>`).join('')}</div>`
  const yl = `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi.toFixed(1).replace('.', ',')}°</text>` +
    `<text class="spark-lbl" x="2" y="${(ys(lo) + 3).toFixed(1)}">${lo.toFixed(1).replace('.', ',')}°</text>`
  let months = ''
  years.forEach((y, i) => { if (y % 20 === 0) months += `<text class="spark-lbl" x="${xs(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${y}</text>` })
  const svg = `<svg class="recc" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    `<line class="spark-axis" x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${W - padR}" y2="${(H - padB).toFixed(1)}"/>` +
    body + months + yl + `<g class="recc-guide"></g></svg>`
  const ctx: RecCtx = { years, val: vals, st: null, dt: null, unit: '°', lo, hi, W, H, padL, padR, padT, padB, trend: trend?.fit ?? null, avg: avg?.values ?? null }
  return { html: svg + cap, ctx }
}

// Volle-Breite-Karte für die Jahresmitteltemperatur (setzt meanCtx für den Hover); '' wenn keine Daten.
function meanCardHtml(): string {
  meanCtx = null
  const am = annualMean
  if (!am || !am.years.length || !am.mean.some((v) => v != null)) return ''
  const chart = meanChart(am)
  meanCtx = chart.ctx
  const y0 = am.years[0], y1 = am.years[am.years.length - 1]
  return `<div class="mean-card">` +
    `<div class="mean-head"><span class="mean-title">🌡 Jahresmitteltemperatur Deutschland</span>` +
    `<span class="mean-sub">Offizielles DWD-Gebietsmittel · ${y0}–${y1} · Trend &amp; 30-J.-Mittel selbst berechnet</span></div>` +
    chart.html + `</div>`
}

function renderRecords(): void {
  if (!series) return
  const years = [...new Set(series.dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  const opts = ['all', ...years.map(String)]
  const bar = `<div class="seg rec-filter">` + opts.map((v) =>
    `<button type="button" data-recyear="${v}" class="${recYear === v ? 'active' : ''}">${v === 'all' ? 'Gesamt' : v}</button>`).join('') + `</div>`
  const yr = recYear === 'all' ? null : +recYear
  const all = recYear === 'all'   // „Gesamt" = Allzeit: Serie/Live gegen Archiv (records.json) mergen
  const nat = records?.national
  const hot = all ? betterNat(eventHeadline(30, 'max'), nat?.hotDaysBest) : eventHeadline(30, 'max')
  const trop = all ? betterNat(eventHeadline(20, 'min'), nat?.tropBest) : eventHeadline(20, 'min')
  const desert = all ? betterNat(eventHeadline(35, 'max'), nat?.desertDaysBest) : eventHeadline(35, 'max')
  const extreme = all ? betterNat(eventHeadline(40, 'max'), nat?.extremeDaysBest) : eventHeadline(40, 'max')
  const glut = all ? betterNat(eventHeadline(45, 'max'), nat?.glutDaysBest) : eventHeadline(45, 'max')
  const wnight = all ? betterNat(eventHeadline(25, 'min'), nat?.wnightBest) : eventHeadline(25, 'min')
  const strop = all ? betterNat(eventHeadline(30, 'min'), nat?.stropBest) : eventHeadline(30, 'min')
  const yrNote = (y: string) => (all ? `Rekordjahr ${y}` : y)
  const gesamtSub = (h: { count: number; year: string }) => (h.count > 0 ? yrNote(h.year) : 'noch nie')
  const M = (s: RecResult | null, a: RecResult | null, higher = true) => (all ? betterRec(s, a, higher) : s)
  const cards = [
    // Reihe 1 — Extreme (Klick öffnet den Rekord-Zeitverlauf)
    recCard('🔥', 'Höchste Temperatur', M(recExtreme(yr, 'max', true), atHottest()), undefined, 'maxTemp'),
    recCard('❄', 'Tiefste Temperatur', M(recExtreme(yr, 'min', false), atColdest(), false), undefined, 'minTemp'),
    recCard('🌴', 'Wärmste Nacht', M(recWarmestNight(yr), atNight()), 'ohne heute', 'warmNight'),
    // Reihe 2 — Tropennächte (Tagesminimum ≥ 20 °C)
    countCard('🌙', 'Längste Tropennacht-Serie', M(recStreak(yr, 20, 'min', true, 'Nächte'), atTropStreak()), 'Nächte', undefined, 'tropStreak'),
    countCard('🌙', 'Meiste Tropennächte', M(recMostDays(yr, 20, 'min', 'Nächte'), atMostTrop()), 'Nächte', undefined, 'tropNMax'),
    statCard('📅', 'Tropennächte gesamt', `${trop.count} Nächte`, gesamtSub(trop), 'tropN'),
    // Reihe 3 — Wüstennächte (≥ 25 °C)
    countCard('🏜', 'Längste Wüstennacht-Serie', M(recStreak(yr, 25, 'min', true, 'Nächte'), atWnightStreak()), 'Nächte', '≥ 25 °C', 'wnightStreak'),
    countCard('🏜', 'Meiste Wüstennächte', M(recMostDays(yr, 25, 'min', 'Nächte'), atMostWnight()), 'Nächte', '≥ 25 °C', 'wnightNMax'),
    statCard('📅', 'Wüstennächte gesamt', `${wnight.count} Nächte`, gesamtSub(wnight), 'wnightN'),
    // Reihe 4 — Super-Tropennächte (≥ 30 °C)
    countCard('🥵', 'Längste Super-Tropennacht-Serie', M(recStreak(yr, 30, 'min', true, 'Nächte'), atStropStreak()), 'Nächte', '≥ 30 °C', 'stropStreak'),
    countCard('🥵', 'Meiste Super-Tropennächte', M(recMostDays(yr, 30, 'min', 'Nächte'), atMostStrop()), 'Nächte', '≥ 30 °C', 'stropNMax'),
    statCard('📅', 'Super-Tropennächte gesamt', `${strop.count} Nächte`, gesamtSub(strop), 'stropN'),
    // Reihe 5 — Hitze (≥ 30 °C)
    countCard('♨', 'Längste Hitzeserie', M(recStreak(yr, 30, 'max', true, 'Tage'), atHeat()), 'Tage', undefined, 'hotStreak'),
    countCard('☀', 'Meiste Hitzetage', M(recMostDays(yr, 30, 'max', 'Tage'), atMostHot()), 'Tage', undefined, 'hotDaysMax'),
    statCard('📅', 'Hitzetage gesamt', `${hot.count} Tage`, gesamtSub(hot), 'hotDays'),
    // Reihe 6 — Wüstentage (≥ 35 °C)
    countCard('🏜', 'Längste Wüstenserie', M(recStreak(yr, 35, 'max', true, 'Tage'), atDesertStreak()), 'Tage', '≥ 35 °C', 'desertStreak'),
    countCard('🌵', 'Meiste Wüstentage', M(recMostDays(yr, 35, 'max', 'Tage'), atMostDesert()), 'Tage', '≥ 35 °C', 'desertDaysMax'),
    statCard('📅', 'Wüstentage gesamt', `${desert.count} Tage`, gesamtSub(desert), 'desertDays'),
    // Reihe 7 — Extreme Hitze (≥ 40 °C)
    countCard('🥵', 'Längste Extremserie', M(recStreak(yr, 40, 'max', true, 'Tage'), atExtremeStreak()), 'Tage', '≥ 40 °C', 'extremeStreak'),
    countCard('🌋', 'Meiste Extremtage', M(recMostDays(yr, 40, 'max', 'Tage'), atMostExtreme()), 'Tage', '≥ 40 °C', 'extremeDaysMax'),
    statCard('📅', 'Extreme Hitze gesamt', `${extreme.count} Tage`, gesamtSub(extreme), 'extremeDays'),
    // Reihe 8 — Gluttage (≥ 45 °C) — in DE bisher nie erreicht
    countCard('🫠', 'Längste Gluttag-Serie', M(recStreak(yr, 45, 'max', true, 'Tage'), atGlutStreak()), 'Tage', '≥ 45 °C', 'glutStreak'),
    countCard('🫠', 'Meiste Gluttage', M(recMostDays(yr, 45, 'max', 'Tage'), atMostGlut()), 'Tage', '≥ 45 °C', 'glutDaysMax'),
    statCard('📅', 'Gluttage gesamt', `${glut.count} Tage`, gesamtSub(glut), 'glutDays'),
  ]
  const ice = M(recStreak(yr, 0, 'max', false, 'Tage'), atIce())
  const info = ice
    ? `<div class="rec-info"><span>🧊 Längste Eisserie <b>${ice.valueText}</b> <span class="dim">${esc(ice.sub)}</span></span></div>`
    : ''
  recordsEl.innerHTML = meanCardHtml() + bar + `<div class="rec-grid">${cards.join('')}</div>` + info
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
    // Serie (2025+) + Archiv-Rekorde (records.json) laden; „Gesamt" merged beides
    if (!seriesPromise || !recordsPromise) {
      metaEl.textContent = 'lädt Verlaufsdaten …'; recordsEl.innerHTML = ''
      void Promise.all([ensureSeries(), ensureRecords()]).then(render); return
    }
    if (!series) { metaEl.innerHTML = '<span class="err">Für die Rekorde liegen noch keine Daten vor.</span>'; return }
    if (!annualMeanPromise) void ensureAnnualMean().then(render)   // Jahresmittel-Karte nachladen (optional)
    metaEl.innerHTML = `Rekorde · <strong>${recYear === 'all' ? 'Allzeit (mit Archiv)' : recYear}</strong>`
    renderRecords()
    return
  }
  recordsEl.hidden = true

  // Jahr-Sub-Ansicht braucht series.json (+ records.json für Allzeit) -> ggf. nachladen
  if (view === 'year' && yearSel !== 'current' && (!seriesPromise || (yearSel === 'all' && !recordsPromise))) {
    metaEl.textContent = 'lädt Verlaufsdaten …'
    rowsEl.innerHTML = ''; mapWrap.innerHTML = ''
    void Promise.all([ensureSeries(), yearSel === 'all' ? ensureRecords() : Promise.resolve()]).then(render)
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
  // Allzeit-Rekorde stammen aus verschiedenen Jahren -> volles Datum (mit Jahr) zeigen
  const obsFmt = view === 'year' && yearSel === 'all' ? fmtDate : fmtTime
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
      `<td class="time">${obsFmt(s.obs)}</td></tr>`
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
  byYear: Map<number, SeriesEntry>; years: number[]; liveYears: Set<number>; ref: RefEntry | null
  recHi: (number | null)[]; recHiY: number[]; recLo: (number | null)[]; recLoY: number[]
  lo: number; hi: number; W: number; H: number
  padL: number; padR: number; padT: number; padB: number
}
let sparkCtx: SparkCtx | null = null

type DistCtx = {
  counts: Map<number, Map<number, number>>; totals: Map<number, number>; years: number[]
  refHist: Map<number, number>; refTotal: number
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
  document.querySelectorAll('.spark-guide, .dist-guide, .recc-guide').forEach((g) => { g.innerHTML = '' })
}

async function openDetail(id: string): Promise<void> {
  detailId = id
  detailTab = 'verlauf'
  recDetailMetric = null
  calYears = 2
  detailEl.hidden = false
  detailBody.innerHTML = '<p class="empty">lädt …</p>'
  await Promise.all([ensureSeries(), ensureReference()])
  renderDetail()                                   // Live-Jahre + Referenz sofort
  void ensureHistory(id).then(() => { if (detailId === id) renderDetail() })  // Historie nachladen
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

// letzte n verschiedene Jahre einer (aufsteigend sortierbaren) Datumsreihe
function lastYears(dates: string[], n: number): Set<number> {
  const ys = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort((a, b) => a - b)
  return new Set(ys.slice(-n))
}

/* ---------- Rekorde je Station (Tabelle + Zeitverlauf im Detail-Tab) ---------- */
// Anzeige-Reihenfolge & Beschriftung der Stations-Rekorde. Nur „Basis"-Metriken (kein
// „Bestwert einer Station" — das ergibt je Station keinen Sinn). Schwellen/Einheiten
// gespiegelt aus REC_METRICS, damit Karte und Zeitverlauf konsistent sind.
const STATION_METRICS: { key: string; icon: string; label: string }[] = [
  { key: 'maxTemp', icon: '🔥', label: 'Höchste Temperatur' },
  { key: 'minTemp', icon: '❄', label: 'Tiefste Temperatur' },
  { key: 'warmNight', icon: '🌴', label: 'Wärmste Nacht' },
  { key: 'hotStreak', icon: '♨', label: 'Längste Hitzeserie' },
  { key: 'hotDays', icon: '☀', label: 'Meiste Hitzetage' },
  { key: 'desertStreak', icon: '🏜', label: 'Längste Wüstenserie' },
  { key: 'desertDays', icon: '🌵', label: 'Meiste Wüstentage' },
  { key: 'tropStreak', icon: '🌙', label: 'Längste Tropennacht-Serie' },
  { key: 'tropN', icon: '🌙', label: 'Meiste Tropennächte' },
  { key: 'extremeStreak', icon: '🥵', label: 'Längste Extremserie' },
  { key: 'extremeDays', icon: '🌋', label: 'Meiste Extremtage' },
  { key: 'wnightStreak', icon: '🏜', label: 'Längste Wüstennacht-Serie' },
  { key: 'wnightN', icon: '🏜', label: 'Meiste Wüstennächte' },
  { key: 'glutStreak', icon: '🫠', label: 'Längste Gluttag-Serie' },
  { key: 'glutDays', icon: '🫠', label: 'Meiste Gluttage' },
  { key: 'stropStreak', icon: '🥵', label: 'Längste Super-Tropennacht-Serie' },
  { key: 'stropN', icon: '🥵', label: 'Meiste Super-Tropennächte' },
]

// Volle Jahres-Zeitreihe je Rekord-Metrik aus der kombinierten Tagesreihe (Historie + Live).
// Semantik spiegelt reference.sh: Jahres-Extreme, Tage/Nächte ≥ Schwelle je Jahr, längste
// Serie je Jahr (aufeinanderfolgende Kalendertage, innerhalb des Jahres). Ergebnis gecacht.
function stationStats(id: string): Record<string, { years: number[]; m: TLMetric }> | null {
  const cached = stationStatsCache.get(id)
  if (cached) return cached
  const combined = combinedCache.get(id)
  const ser = combined?.ser ?? series?.stations[id]
  const dates = combined?.dates ?? series?.dates
  if (!ser || !dates || !dates.length) return null

  const HEAT = [30, 35, 40, 45], NIGHT = [20, 25, 30]
  const heatKey: Record<number, [string, string]> = { 30: ['hotDays', 'hotStreak'], 35: ['desertDays', 'desertStreak'], 40: ['extremeDays', 'extremeStreak'], 45: ['glutDays', 'glutStreak'] }
  const nightKey: Record<number, [string, string]> = { 20: ['tropN', 'tropStreak'], 25: ['wnightN', 'wnightStreak'], 30: ['stropN', 'stropStreak'] }
  type Y = {
    hasMax: boolean; hasMin: boolean   // ob das Jahr überhaupt Max-/Min-Tage hat (Reihenlücken je Variable)
    maxV: number | null; maxD: string | null; minV: number | null; minD: string | null; nightV: number | null; nightD: string | null
    dayCount: Record<number, number>; nightCount: Record<number, number>; dayStreak: Record<number, number>; nightStreak: Record<number, number>
  }
  const yr = new Map<number, Y>()
  const getY = (y: number): Y => {
    let o = yr.get(y)
    if (!o) { o = { hasMax: false, hasMin: false, maxV: null, maxD: null, minV: null, minD: null, nightV: null, nightD: null, dayCount: {}, nightCount: {}, dayStreak: {}, nightStreak: {} }; yr.set(y, o) }
    return o
  }
  const dayRun: Record<number, number> = {}, nightRun: Record<number, number> = {}
  let prevOrd = -2, prevYear = -1
  for (let i = 0; i < dates.length; i++) {
    const ds = dates[i], y = +ds.slice(0, 4)
    const ord = Math.floor(Date.parse(ds + 'T00:00:00Z') / DAY_MS)
    const mx = ser.max[i], mn = ser.min[i]
    const o = getY(y)
    if (mx != null) {
      o.hasMax = true
      if (o.maxV == null || mx > o.maxV) { o.maxV = mx; o.maxD = ds }
    }
    if (mn != null) {
      o.hasMin = true
      if (o.minV == null || mn < o.minV) { o.minV = mn; o.minD = ds }
      if (o.nightV == null || mn > o.nightV) { o.nightV = mn; o.nightD = ds }
    }
    const cons = ord === prevOrd + 1 && y === prevYear    // aufeinanderfolgender Kalendertag, gleiches Jahr
    for (const t of HEAT) {
      if (mx != null && mx >= t) {
        o.dayCount[t] = (o.dayCount[t] || 0) + 1
        dayRun[t] = (cons ? dayRun[t] || 0 : 0) + 1
        if (dayRun[t] > (o.dayStreak[t] || 0)) o.dayStreak[t] = dayRun[t]
      } else dayRun[t] = 0
    }
    for (const t of NIGHT) {
      if (mn != null && mn >= t) {
        o.nightCount[t] = (o.nightCount[t] || 0) + 1
        nightRun[t] = (cons ? nightRun[t] || 0 : 0) + 1
        if (nightRun[t] > (o.nightStreak[t] || 0)) o.nightStreak[t] = nightRun[t]
      } else nightRun[t] = 0
    }
    prevOrd = ord; prevYear = y
  }

  // Jahresbereich je Variable getrennt: eine max-basierte Metrik (Hitze) darf nicht durch
  // frühe reine Min-Jahre (und umgekehrt) mit Null-Strecken verwässert werden — das zerhaut
  // Trend & 30-J.-Mittel. Führende/nachlaufende Fremdvariablen-Jahre entfallen so; interne
  // Lücken (z. B. Mannheim: zeitweise keine Min-Daten) bleiben als 0/lücke bestehen.
  const contiguous = (has: (o: Y) => boolean): number[] | null => {
    const ys: number[] = []
    yr.forEach((o, y) => { if (has(o)) ys.push(y) })
    if (!ys.length) return null
    ys.sort((a, b) => a - b)
    const r: number[] = []
    for (let y = ys[0]; y <= ys[ys.length - 1]; y++) r.push(y)
    return r
  }
  const maxYears = contiguous((o) => o.hasMax), minYears = contiguous((o) => o.hasMin)
  if (!maxYears && !minYears) return null
  const out: Record<string, { years: number[]; m: TLMetric }> = {}
  const put = (k: string, v: { years: number[]; m: TLMetric } | null) => { if (v) out[k] = v }
  const extSeries = (years: number[] | null, pick: (o: Y) => [number | null, string | null], dir: 'max' | 'min') => {
    if (!years) return null
    const val: (number | null)[] = [], dt: (string | null)[] = []
    for (const y of years) { const o = yr.get(y); const p = o ? pick(o) : [null, null] as [number | null, string | null]; val.push(p[0]); dt.push(p[1]) }
    return { years, m: { kind: 'ext' as const, dir, val, dt } }
  }
  put('maxTemp', extSeries(maxYears, (o) => [o.maxV, o.maxD], 'max'))
  put('minTemp', extSeries(minYears, (o) => [o.minV, o.minD], 'min'))
  put('warmNight', extSeries(minYears, (o) => [o.nightV, o.nightD], 'max'))
  const cntSeries = (years: number[] | null, field: 'dayCount' | 'nightCount' | 'dayStreak' | 'nightStreak', t: number) => {
    if (!years) return null
    const all: number[] = []
    for (const y of years) { const o = yr.get(y); all.push(o ? (o[field][t] || 0) : 0) }
    return { years, m: { kind: 'count' as const, all } }
  }
  for (const t of HEAT) { const [dk, sk] = heatKey[t]; put(dk, cntSeries(maxYears, 'dayCount', t)); put(sk, cntSeries(maxYears, 'dayStreak', t)) }
  for (const t of NIGHT) { const [dk, sk] = nightKey[t]; put(dk, cntSeries(minYears, 'nightCount', t)); put(sk, cntSeries(minYears, 'nightStreak', t)) }
  if (!Object.keys(out).length) return null
  stationStatsCache.set(id, out)
  return out
}

// Rekord-Wert (Headline) je Metrik — autoritativ aus records.json (via reference.sh, inkl.
// tagesaktuellem --recent-Merge). Bewusst nicht aus der berechneten Zeitreihe abgeleitet:
// das KL-Produkt hinter records.json ist für das laufende Jahr frischer/exakter als die
// kombinierte POI+Archiv-Reihe, aus der der Graph gezeichnet wird.
function recEntryHead(key: string, r: RecEntry, unit: string): { valueText: string; sub: string; has: boolean } | null {
  const fmtV = (v: number) => (unit === '°' ? v.toFixed(1).replace('.', ',') + '°' : `${v} ${unit}`)
  const span = (a?: string, b?: string) => (a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : a ? fmtDate(a) : '')
  const ext = (v?: number, d?: string) => (v == null ? null : { valueText: fmtV(v), sub: d ? fmtDate(d) : '', has: true })
  const cnt = (v?: number, y?: number) => ({ valueText: fmtV(v ?? 0), sub: (v ?? 0) > 0 && y ? `Rekordjahr ${y}` : 'noch nie', has: (v ?? 0) > 0 })
  const streak = (v?: number, a?: string, b?: string) => ({ valueText: fmtV(v ?? 0), sub: (v ?? 0) > 0 ? span(a, b) : 'noch nie', has: (v ?? 0) > 0 })
  switch (key) {
    case 'maxTemp': return ext(r.maxC, r.maxDate)
    case 'minTemp': return ext(r.minC, r.minDate)
    case 'warmNight': return ext(r.nightC, r.nightDate)
    case 'hotDays': return cnt(r.hotDays, r.hotYear)
    case 'desertDays': return cnt(r.desertDays, r.desertYear)
    case 'extremeDays': return cnt(r.extremeDays, r.extremeYear)
    case 'glutDays': return cnt(r.glutDays, r.glutYear)
    case 'tropN': return cnt(r.tropN, r.tropYear)
    case 'wnightN': return cnt(r.wnightN, r.wnightYear)
    case 'stropN': return cnt(r.stropN, r.stropYear)
    case 'hotStreak': return streak(r.heatLen, r.heatStart, r.heatEnd)
    case 'desertStreak': return streak(r.desertLen, r.desertStart, r.desertEnd)
    case 'extremeStreak': return streak(r.extremeLen, r.extremeStart, r.extremeEnd)
    case 'glutStreak': return streak(r.glutLen, r.glutStart, r.glutEnd)
    case 'tropStreak': return streak(r.tropLen, r.tropStart, r.tropEnd)
    case 'wnightStreak': return streak(r.wnightLen, r.wnightStart, r.wnightEnd)
    case 'stropStreak': return streak(r.stropLen, r.stropStart, r.stropEnd)
    default: return null
  }
}

// Inhalt des Rekorde-Tabs: Übersicht (Karten) oder — wenn eine Metrik gewählt ist — deren
// Zeitverlauf mit „zurück". Setzt recCtx (für den Hover) als Seiteneffekt via Rückgabe.
function stationRecordPanel(id: string): { html: string; ctx: RecCtx | null } {
  const rec = records?.records[id]
  if (!rec) return { html: '<p class="empty">Keine Rekorddaten verfügbar.</p>', ctx: null }
  const isExt = (k: string) => k === 'maxTemp' || k === 'minTemp' || k === 'warmNight'

  // Einzelne Metrik gewählt -> Zeitverlauf (Graph aus der kombinierten Reihe) + „zurück".
  if (recDetailMetric) {
    const key = recDetailMetric, meta = REC_METRICS[key]
    const back = `<button type="button" class="rec-back" data-recback="1">← Alle Rekorde</button>`
    const s = stationStats(id)?.[key]
    if (!s) return { html: back + '<p class="empty">Kein Verlauf verfügbar.</p>', ctx: null }
    const chart = recordChart(key, s.years, s.m, true)
    const head = recEntryHead(key, rec, meta.unit)
    const html = back +
      `<h3 class="rec-detail-h">${esc(meta.title)}${meta.thr ? `<span class="detail-badge">${meta.thr}</span>` : ''}</h3>` +
      (head?.has ? `<div class="rec-detail-sub">Rekord: <b>${esc(head.valueText)}</b> · ${esc(head.sub)}</div>` : '') +
      `<div class="detail-panel">${chart.html}</div>`
    return { html, ctx: chart.ctx }
  }

  // Übersicht: Karten (Werte aus records.json). Extreme immer; Zähl-/Serien-Metriken nur wenn
  // je erreicht — nicht erreichte Schwellen werden knapp als „nie erreicht" gesammelt.
  const cards: string[] = [], never: string[] = []
  for (const sm of STATION_METRICS) {
    const meta = REC_METRICS[sm.key]
    const head = recEntryHead(sm.key, rec, meta.unit)
    const note = meta.thr ? ` <span class="rec-note">${meta.thr}</span>` : ''
    const headTxt = `<span class="rec-ico">${sm.icon}</span><span class="rec-k">${sm.label}${note}</span>`
    if (head?.has) {
      const vcls = isExt(sm.key) ? (sm.key === 'minTemp' ? 'cool' : 'hot') : ''
      cards.push(`<button type="button" class="rec-card" data-recmetric="${sm.key}">${headTxt}` +
        `<span class="rec-v ${vcls}">${head.valueText}</span><span class="rec-sub">${esc(head.sub)}</span></button>`)
    } else if (!sm.key.includes('Streak')) {
      never.push(`${sm.label}${meta.thr ? ` (${meta.thr})` : ''}`)
    }
  }
  const neverTxt = never.length ? `<div class="rec-never">Nie erreicht: ${esc(never.join(' · '))}</div>` : ''
  const html = `<div class="rec-grid">${cards.join('')}</div>${neverTxt}` +
    `<div class="rec-hint dim">Karte antippen für den Verlauf über die Jahre.</div>`
  return { html, ctx: null }
}

function renderDetail(): void {
  const id = detailId
  if (!id) return
  const name = stName(id)
  const ser = series?.stations[id]
  const isLive = !!ser || !!coords[id]          // POI: hat „Jetzt"/Live-Verlauf (series/coords)
  const combined = combinedCache.get(id)
  // Reine Klimastation (kein Live-Feed): die Detailansicht speist sich allein aus dem
  // Tagesarchiv (history/). Solange die Historie noch lädt: Ladehinweis; ist sie geladen,
  // aber leer/nicht vorhanden: kurzer Hinweis statt leerer Charts.
  if (!isLive && !combined) {
    detailBody.innerHTML = `<h2>${esc(name)}</h2>` +
      `<div class="detail-sub">Reine DWD-Klimastation</div>` +
      (historyRaw.has(id)
        ? `<p class="empty">Diese Station meldet nicht stündlich (kein „Jetzt"/Live-Verlauf) ` +
          `und hat keine abrufbare Tageshistorie. Sie erscheint nur in den Allzeit-Rekorden.</p>`
        : `<p class="empty">lädt …</p>`)
    return
  }
  const cur = latest?.stations.find((s) => s.id === id)
  const y = tops?.periods.year.stations.find((s) => s.id === id)
  const dates = series?.dates ?? []
  const ref = reference?.stations[id] ?? null
  // Label = tatsächlich genutzte Jahresspanne der Station (nicht die Zielperiode),
  // da manche Stationen nur einen Teil von 1991–2020 abdecken (z. B. Zugspitze ab 2011).
  const refPeriod = ref?.y0 && ref?.y1 ? `${ref.y0}–${ref.y1}` : (reference?.period ?? '')
  // Charts nutzen die kombinierte Reihe (Historie + Live), sobald die Historie geladen ist;
  // Fakten/Zähler bleiben auf der Live-Reihe (kanonisch für den Rest der Seite).
  const chartSer = combined?.ser ?? ser
  const chartDates = combined?.dates ?? dates
  // „Aktuelle" Jahre (farbige Linien vs. Normal): bei POI die Live-Jahre, bei reinen
  // Archivstationen die letzten beiden Jahre der eigenen Reihe (kein Live vorhanden).
  const liveYears = isLive
    ? new Set(dates.map((d) => +d.slice(0, 4)))
    : lastYears(chartDates, 2)

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
    tabBtn('vmin', 'Verteilung Min') + tabBtn('kalender', 'Kalender') +
    tabBtn('rekorde', 'Rekorde') + `</div>`

  let panel = '<p class="empty">Kein Verlauf verfügbar.</p>'
  sparkCtx = null
  distCtx = null
  recCtx = null
  if (detailTab === 'rekorde') {
    if (!records) {                                  // records.json (Rekord-Werte) erst bei Bedarf laden
      panel = '<p class="empty">lädt Rekorde …</p>'
      void ensureRecords().then(() => { if (detailId === id && detailTab === 'rekorde') renderDetail() })
    } else {
      const r = stationRecordPanel(id)
      recCtx = r.ctx
      panel = r.html
    }
  } else if (chartSer) {
    if (detailTab === 'verlauf') {
      const o = overlayBuild(chartSer, chartDates, ref, liveYears)
      sparkCtx = o.ctx
      panel = o.html + overlayLegend(liveYears, ref, refPeriod)
    } else if (detailTab === 'vmax' || detailTab === 'vmin') {
      const metric = detailTab === 'vmax' ? 'max' : 'min'
      const o = distBuild(chartSer, chartDates, metric, ref, liveYears)
      distCtx = o.ctx
      panel = o.html + distLegend(metric, liveYears, ref, refPeriod)
    } else {
      panel = calendarPanel(chartSer, chartDates, calYears)
    }
  }

  detailBody.innerHTML =
    `<h2>${esc(name)}${isRecordToday ? '<span class="detail-badge">★ Jahresrekord heute</span>' : ''}</h2>` +
    `<div class="detail-sub">${isLive ? 'Tagesmaximum & -minimum je Tag' : 'Reine DWD-Klimastation · Tagesarchiv'}</div>` +
    `<div class="facts">${facts.join('')}</div>` +
    (ser ? countersHtml(ser, dates) : '') +
    tabs +
    `<div class="detail-panel">${panel}</div>`
}

function fact(k: string, v: string, cls: string, sub?: string): string {
  return `<div class="fact"><div class="k">${k}</div>` +
    `<div class="v ${cls}">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`
}

function overlayBuild(ser: SeriesEntry, dates: string[], ref: RefEntry | null, liveYears: Set<number>): { html: string; ctx: SparkCtx | null } {
  const byYear = new Map<number, SeriesEntry>()
  dates.forEach((ds, i) => {
    const Y = +ds.slice(0, 4), dd = doy(ds)
    let o = byYear.get(Y)
    if (!o) { o = { max: Array(367).fill(null), min: Array(367).fill(null) }; byYear.set(Y, o) }
    o.max[dd] = ser.max[i]; o.min[dd] = ser.min[i]
  })
  const years = [...byYear.keys()].sort((a, b) => a - b)
  // Allzeit-Rekorde je Kalendertag (für den Hover, sinnvoll bei tiefer Historie)
  const recHi: (number | null)[] = Array(367).fill(null), recHiY: number[] = Array(367).fill(0)
  const recLo: (number | null)[] = Array(367).fill(null), recLoY: number[] = Array(367).fill(0)
  // gezeichnet werden nur die Live-Jahre (sonst erschlägt die Historie das aktuelle Jahr);
  // die Skala (lo/hi) richtet sich nur nach Gezeichnetem, die Rekorde nutzen die volle Historie.
  const vals: number[] = []
  byYear.forEach((o, Y) => {
    const live = liveYears.has(Y)
    for (let d = 1; d <= 366; d++) {
      const mx = o.max[d], mn = o.min[d]
      if (mx != null) { if (live) vals.push(mx); if (recHi[d] == null || mx > recHi[d]!) { recHi[d] = mx; recHiY[d] = Y } }
      if (mn != null) { if (live) vals.push(mn); if (recLo[d] == null || mn < recLo[d]!) { recLo[d] = mn; recLoY[d] = Y } }
    }
  })
  if (ref) { for (const v of ref.max) if (v != null) vals.push(v); for (const v of ref.min) if (v != null) vals.push(v) }
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
  // nur die Live-Jahre zeichnen (aktuelles kräftig, Vorjahr blass); ältere nur im Hover als Rekord
  const curY = liveYears.size ? Math.max(...liveYears) : (years[years.length - 1] ?? 0)
  let paths = ''
  for (const Y of years) {
    if (!liveYears.has(Y)) continue
    const o = byYear.get(Y)!
    const f = Y === curY ? '' : ' faint'
    paths += `<path class="spark-min${f}" d="${line(o.min)}"/><path class="spark-max${f}" d="${line(o.max)}"/>`
  }
  // Normal-Kurven (Referenzperiode) als ruhiger Hintergrund unter den Jahreslinien
  const refPaths = ref
    ? `<path class="spark-ref-min" d="${line(ref.min)}"/><path class="spark-ref-max" d="${line(ref.max)}"/>` : ''
  const zero = (lo < 0 && hi > 0)
    ? `<line class="spark-zero" x1="${padL}" y1="${ys(0).toFixed(1)}" x2="${W - padR}" y2="${ys(0).toFixed(1)}"/>` : ''
  // Hitze-Schwellen 20/30/35/40° – nur wenn im sichtbaren Bereich (mit Gradzahl rechts)
  const heat = [20, 30, 35, 40].filter((t) => t >= lo && t <= hi).map((t) => {
    const yy = ys(t).toFixed(1)
    return `<line class="spark-heat" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>` +
      `<text class="spark-heat-lbl" x="${(W - padR).toFixed(1)}" y="${(ys(t) - 1.5).toFixed(1)}" text-anchor="end">${t}°</text>`
  }).join('')
  const mDoy = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
  const mLbl = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
  let months = ''
  mDoy.forEach((d, i) => { months += `<text class="spark-lbl" x="${xs(d).toFixed(1)}" y="${H - 4}">${mLbl[i]}</text>` })
  const yl = `<text class="spark-lbl" x="2" y="${(ys(hi) + 3).toFixed(1)}">${hi.toFixed(0)}°</text>` +
    `<text class="spark-lbl" x="2" y="${(ys(lo) + 3).toFixed(1)}">${lo.toFixed(0)}°</text>`
  const html = `<svg class="spark" viewBox="0 0 ${W} ${H}">` +
    `<line class="spark-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
    zero + heat + refPaths + paths + months + yl + `<g class="spark-guide"></g></svg>`
  return { html, ctx: { byYear, years, liveYears, ref, recHi, recHiY, recLo, recLoY, lo, hi, W, H, padL, padR, padT, padB } }
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
  // nur die Live-Jahre einzeln (sonst wären es bei tiefer Historie Dutzende Zeilen)
  const shown = c.years.filter((Y) => c.liveYears.has(Y)).sort((a, b) => b - a)
  for (const Y of shown) {
    const o = c.byYear.get(Y)!
    const mx = o.max[d], mn = o.min[d]
    if (mx != null) g += `<circle class="guide-dot mx" cx="${gx.toFixed(1)}" cy="${ys(mx).toFixed(1)}" r="2.5"/>`
    if (mn != null) g += `<circle class="guide-dot mn" cx="${gx.toFixed(1)}" cy="${ys(mn).toFixed(1)}" r="2.5"/>`
    if (mx != null || mn != null)
      rows.push(`<span class="ty${Y === curY ? '' : ' faintlbl'}">${Y}</span> ` +
        `<span class="mx">${mx != null ? mx.toFixed(1) + '°' : '–'}</span> / ` +
        `<span class="mn">${mn != null ? mn.toFixed(1) + '°' : '–'}</span>`)
  }
  const rmx = c.ref?.max[d], rmn = c.ref?.min[d]
  if (rmx != null) g += `<circle class="guide-dot ref" cx="${gx.toFixed(1)}" cy="${ys(rmx).toFixed(1)}" r="2.5"/>`
  if (rmn != null) g += `<circle class="guide-dot ref" cx="${gx.toFixed(1)}" cy="${ys(rmn).toFixed(1)}" r="2.5"/>`
  if (rmx != null || rmn != null)
    rows.push(`<span class="ty reflbl">Normal</span> ` +
      `<span class="mx">${rmx != null ? rmx.toFixed(1) + '°' : '–'}</span> / ` +
      `<span class="mn">${rmn != null ? rmn.toFixed(1) + '°' : '–'}</span>`)
  // Allzeit-Rekord dieses Kalendertags (über die gesamte Historie)
  const rhi = c.recHi[d], rlo = c.recLo[d]
  if (rhi != null || rlo != null)
    rows.push(`<span class="ty">Rekord</span> ` +
      `<span class="mx">${rhi != null ? rhi.toFixed(1) + '°' : '–'}${rhi != null ? ` <span class="dim">${c.recHiY[d]}</span>` : ''}</span> / ` +
      `<span class="mn">${rlo != null ? rlo.toFixed(1) + '°' : '–'}${rlo != null ? ` <span class="dim">${c.recLoY[d]}</span>` : ''}</span>`)
  const gg = svg.querySelector('.spark-guide')
  if (gg) gg.innerHTML = g
  if (rows.length) {
    const dt = new Date(Date.UTC(curY, 0, d))
    const lbl = `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.`
    showTip(`<b>${lbl}</b><br>${rows.join('<br>')}`, clientX, clientY)
  } else hideTip()
}

function overlayLegend(liveYears: Set<number>, ref: RefEntry | null, period: string): string {
  const yl = [...liveYears].sort((a, b) => a - b).join(' · ')
  const refl = ref ? ` &nbsp; <span class="reflbl">— Normal ${period}</span>` : ''
  return `<div class="spark-legend">${yl} &nbsp; <span class="mx">— Max</span> <span class="mn">— Min</span>${refl}</div>`
}

// Verteilung: je Jahr ein Häufigkeits-Polygon "Anzahl Tage (y) über Temperatur (x, 1°C-Bins)".
// Bewusst ohne Gates -- gezeigt wird die Rohlage aus series.json (wie der Verlauf).
function distBuild(ser: SeriesEntry, dates: string[], metric: 'max' | 'min', ref: RefEntry | null, liveYears: Set<number>): { html: string; ctx: DistCtx | null } {
  // nur aktuelles Jahr + Vorjahr (die Live-Jahre); die Skala richtet sich danach + nach Normal
  const counts = new Map<number, Map<number, number>>()
  let lo = Infinity, hi = -Infinity
  dates.forEach((ds, i) => {
    const Y = +ds.slice(0, 4)
    if (!liveYears.has(Y)) return
    const v = ser[metric][i]
    if (v == null) return
    const t = Math.round(v)
    let m = counts.get(Y)
    if (!m) { m = new Map(); counts.set(Y, m) }
    m.set(t, (m.get(t) ?? 0) + 1)
    if (t < lo) lo = t
    if (t > hi) hi = t
  })
  if (!counts.size) return { html: '<p class="empty">Kein Verlauf verfügbar.</p>', ctx: null }
  // Referenzverteilung (gepoolt über die Normalperiode) -> Bins + Spanne mit aufnehmen
  const refHist = new Map<number, number>()
  let refTotal = 0
  if (ref) {
    const h = metric === 'max' ? ref.histMax : ref.histMin
    for (const k in h) {
      const t = +k, n = h[k]
      refHist.set(t, n); refTotal += n
      if (t < lo) lo = t
      if (t > hi) hi = t
    }
  }
  if (hi - lo < 1) { hi += 1; lo -= 1 }
  // je Jahr auf Anteil der Tage normieren -> Jahre vergleichbar (Teiljahr verzerrt nicht)
  const totals = new Map<number, number>()
  counts.forEach((m, Y) => { let s = 0; m.forEach((c) => { s += c }); totals.set(Y, s) })
  const pct = (Y: number, t: number) => ((counts.get(Y)?.get(t) ?? 0) / (totals.get(Y) || 1)) * 100
  const pctRef = (t: number) => ((refHist.get(t) ?? 0) / (refTotal || 1)) * 100
  const showRef = refTotal > 0
  const years = [...counts.keys()].sort((a, b) => a - b)   // nur die Live-Jahre
  let maxPct = 1
  for (const Y of years) (counts.get(Y) as Map<number, number>).forEach((_, t) => { const p = pct(Y, t); if (p > maxPct) maxPct = p })
  if (showRef) for (let t = lo; t <= hi; t++) { const p = pctRef(t); if (p > maxPct) maxPct = p }
  const curY = years[years.length - 1]
  const W = 540, H = 170, padL = 30, padR = 8, padT = 10, padB = 22
  const xs = (t: number) => padL + ((t - lo) / (hi - lo)) * (W - padL - padR)
  const ys = (p: number) => padT + (1 - p / maxPct) * (H - padT - padB)
  const tone = metric === 'max' ? 'hot' : 'cool'
  let paths = ''
  // Referenzverteilung zuerst (ruhiger Hintergrund unter den Jahreslinien)
  if (showRef) {
    let dRef = ''
    for (let t = lo; t <= hi; t++) dRef += `${t === lo ? 'M' : 'L'}${xs(t).toFixed(1)},${ys(pctRef(t)).toFixed(1)} `
    paths += `<path class="dist-line ref" d="${dRef.trim()}"/>`
  }
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
  return { html, ctx: { counts, totals, years, refHist, refTotal, lo, hi, maxPct, metric, W, H, padL, padR, padT, padB } }
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
  // Perzentil = Anteil der Tage ≤ aktueller Temperatur (kumulativ von unten)
  const pctl = (m: Map<number, number> | undefined, total: number): number => {
    if (!m || !total) return 0
    let s = 0
    for (let b = c.lo; b <= t; b++) s += m.get(b) ?? 0
    return Math.round((s / total) * 100)
  }
  let g = `<line class="guide-line" x1="${gx.toFixed(1)}" y1="${c.padT}" x2="${gx.toFixed(1)}" y2="${(c.H - c.padB).toFixed(1)}"/>`
  const rows: string[] = []
  for (const Y of [...c.years].sort((a, b) => b - a)) {
    const m = c.counts.get(Y)
    const total = c.totals.get(Y) || 1
    const n = m?.get(t) ?? 0
    const p = (n / total) * 100
    g += `<circle class="guide-dot ${tone}" cx="${gx.toFixed(1)}" cy="${ys(p).toFixed(1)}" r="2.5"/>`
    rows.push(`<span class="ty${Y === curY ? '' : ' faintlbl'}">${Y}</span> ` +
      `<span class="${tone}">${p.toFixed(1)} %</span> <span class="dim">${n} ${n === 1 ? 'Tag' : 'Tage'} · P${pctl(m, total)}</span>`)
  }
  if (c.refTotal > 0) {
    const n = c.refHist.get(t) ?? 0
    const p = (n / c.refTotal) * 100
    const perYear = n * 365.25 / c.refTotal       // über die Normalperiode auf 1 Jahr gerechnet
    g += `<circle class="guide-dot ref" cx="${gx.toFixed(1)}" cy="${ys(p).toFixed(1)}" r="2.5"/>`
    rows.push(`<span class="ty reflbl">Normal</span> <span class="reflbl">${p.toFixed(1)} %</span> <span class="dim">${perYear.toFixed(1)} Tage/Jahr · P${pctl(c.refHist, c.refTotal)}</span>`)
  }
  const gg = svg.querySelector('.dist-guide')
  if (gg) gg.innerHTML = g
  showTip(`<b>${t}°</b><br>${rows.join('<br>')}`, clientX, clientY)
}

function distLegend(metric: 'max' | 'min', liveYears: Set<number>, ref: RefEntry | null, period: string): string {
  const yl = [...liveYears].sort((a, b) => a - b).join(' · ')
  const tone = metric === 'max' ? 'mx' : 'mn'
  const metricWord = metric === 'max' ? 'Tagesmaxima' : 'Tagesminima'
  const refl = ref ? ` <span class="reflbl">— Normal ${period}</span>` : ''
  return `<div class="spark-legend">${yl} &nbsp; <span class="${tone}">— Jahre</span>${refl} &nbsp; · ${metricWord}, Anteil (%) je 1°C</div>`
}

function calendarPanel(ser: SeriesEntry, dates: string[], limit: number | 'all'): string {
  // Tagesmaxima einmal je Jahr/Kalendertag bucketen (nicht je Jahr neu scannen)
  const byYear = new Map<number, (number | null)[]>()
  dates.forEach((ds, i) => {
    const Y = +ds.slice(0, 4)
    let a = byYear.get(Y)
    if (!a) { a = Array(367).fill(null); byYear.set(Y, a) }
    a[doy(ds)] = ser.max[i]
  })
  const allYears = [...byYear.keys()].sort((a, b) => b - a)   // neueste Jahre zuerst
  const total = allYears.length
  const shown = limit === 'all' ? allYears : allYears.slice(0, limit)
  // Umschalter nur wenn es mehr als die Standard-2 Jahre gibt
  let seg = ''
  if (total > 2) {
    const opts: (number | 'all')[] = ([2, 10, 30] as const).filter((n) => n < total)
    opts.push('all')
    seg = `<div class="seg cal-seg">` + opts.map((o) => {
      const lbl = o === 'all' ? `Alle (${total})` : String(o)
      return `<button data-calyears="${o}" class="${limit === o ? 'active' : ''}">${lbl}</button>`
    }).join('') + `</div>`
  }
  return seg + `<div class="cal-wrap">${shown.map((y) => calendarSvg(byYear.get(y)!, y)).join('')}</div>` +
    `<div class="spark-legend">eine Zelle = ein Tag · Farbe = Tagesmaximum${total > 2 ? ` · ${shown.length} von ${total} Jahren` : ''}</div>`
}

function calendarSvg(maxByDoy: (number | null)[], year: number): string {
  const cell = 9, gap = 1.6
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay()
  const off = (jan1 + 6) % 7
  const days = leap ? 366 : 365
  // Datumslabel je Kalendertag einmal direkt bauen (kein Date/Intl je Zelle -> ~42k Zellen schnell)
  const ml = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const dLbl: string[] = Array(367)
  let dn = 1
  for (let m = 0; m < 12; m++)
    for (let day = 1; day <= ml[m]; day++) {
      dLbl[dn++] = `${String(day).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}.${year}`
    }
  let cells = '', maxCol = 0
  for (let d = 1; d <= days; d++) {
    const idx = d - 1 + off
    const col = Math.floor(idx / 7), row = idx % 7
    if (col > maxCol) maxCol = col
    const v = maxByDoy[d]
    const cls = v == null ? 'cal-empty' : tempClass(v)
    cells += `<rect class="cal ${cls}" x="${(col * (cell + gap)).toFixed(1)}" y="${(row * (cell + gap)).toFixed(1)}" width="${cell}" height="${cell}" data-d="${dLbl[d]}" data-v="${v == null ? '—' : v.toFixed(1) + '°'}"></rect>`
  }
  const W = (maxCol + 1) * (cell + gap), H = 7 * (cell + gap)
  return `<div class="cal-year"><div class="cal-label">${year}</div>` +
    `<svg class="cal-svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="xMinYMin meet">${cells}</svg></div>`
}

function closeDetail(): void { detailEl.hidden = true; detailBody.innerHTML = ''; sparkCtx = null; distCtx = null; recCtx = null; hideTip() }

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
  const rc = (e.target as HTMLElement).closest<HTMLElement>('[data-rec]')
  if (rc) { void openRecord(rc.dataset.rec!); return }         // Rekord über die Zeit
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
  if (card) void openDetail(card.dataset.id!)                  // Station (Meiste/Serie)
})
yearSelEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-year]')
  if (!b) return
  yearSel = b.dataset.year!
  syncControls(); writeHash(); render()
})
detailBody.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]')
  if (t) { detailTab = t.dataset.tab as DetailTab; recDetailMetric = null; renderDetail(); return }
  const rm = (e.target as HTMLElement).closest<HTMLElement>('[data-recmetric]')
  if (rm) { recDetailMetric = rm.dataset.recmetric!; renderDetail(); return }   // Stations-Rekord -> Zeitverlauf
  const rb = (e.target as HTMLElement).closest<HTMLElement>('[data-recback]')
  if (rb) { recDetailMetric = null; renderDetail(); return }                    // zurück zur Übersicht
  const cy = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-calyears]')
  if (cy) {
    const v = cy.dataset.calyears!
    calYears = v === 'all' ? 'all' : +v
    renderDetail()
  }
})
detailBody.addEventListener('mousemove', (e) => {
  if (!(e.target instanceof Element)) return
  const cal = e.target.closest('.cal')
  if (cal) { showTip(`<b>${cal.getAttribute('data-d')}</b> · ${cal.getAttribute('data-v')}`, e.clientX, e.clientY); return }
  const svg = e.target.closest('.spark') as SVGSVGElement | null
  if (svg) { onSparkMove(svg, e.clientX, e.clientY); return }
  const dist = e.target.closest('.dist') as SVGSVGElement | null
  if (dist) { onDistMove(dist, e.clientX, e.clientY); return }
  const recc = e.target.closest('.recc') as SVGSVGElement | null
  if (recc) { onRecordMove(recc, e.clientX, e.clientY, recCtx); return }
  hideTip(); clearGuide()
})
detailBody.addEventListener('mouseleave', () => { hideTip(); clearGuide() })
// Hover über der Jahresmittel-Karte auf der Rekorde-Seite (eigener Kontext, nicht das Modal)
recordsEl.addEventListener('mousemove', (e) => {
  if (!(e.target instanceof Element)) return
  const recc = e.target.closest('.recc') as SVGSVGElement | null
  if (recc) { onRecordMove(recc, e.clientX, e.clientY, meanCtx); return }
  hideTip(); clearGuide()
})
recordsEl.addEventListener('mouseleave', () => { hideTip(); clearGuide() })
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
