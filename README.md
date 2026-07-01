# 🌡 Temperatur-Leaderboard Deutschland

Live-Rangliste der Lufttemperatur aller DWD-Messstationen in Deutschland —
plus Tages-, Wochen-, Monats- und Jahreswerte, Karte und Stationsverlauf.
Daten vom [Deutschen Wetterdienst](https://opendata.dwd.de), Website als
statische Vanilla-TypeScript-Seite (kein Framework), stündlich automatisch
aktualisiert per GitHub Actions und über GitHub Pages ausgeliefert.

## Features

- **Rangliste** aller ~200 Stationen — „Jetzt" (Live) sowie Höchst-/Tiefstwerte
  für **Tag / Woche / Monat / Jahr**; im Jahr-Umschalter zeigt **„Allzeit"** den
  Allzeit-Rekord je Station aus dem vollen DWD-Archiv (gemerged mit den Live-Jahren).
- **Tabelle & Deutschlandkarte** (Stationen als Punkte, nach Temperatur eingefärbt).
- **Stationsdetail** per Klick (lädt die volle Stationshistorie on-demand nach,
  je nach Station bis ins 19. Jahrhundert zurück):
  - **Verlauf** — Tagesmax/-min des aktuellen & Vorjahrs plus **Normal-Kurve 1991–2020**
    und Schwellenlinien bei 20/30/35/40 °C; Hover mit Werten + Allzeit-Rekord des Tages.
  - **Verteilung Max/Min** — Häufigkeit je 1 °C für aktuelles & Vorjahr gegen das Normal;
    Hover mit Perzentil und Normal-Tagen pro Jahr.
  - **Kalender** — Heatmap je Jahr, umschaltbar 2 / 10 / 30 / alle Jahre.
  - Jahres-Höchst/-Tiefst, Badge bei neuem Jahresrekord.
- **Überblicks-Strip**: heißeste/kälteste Station, Spanne, größter Steiger/Faller,
  Jahresrekorde des Tages.
- **Funfacts-Banderole** (Laufband mit Temperatur-Fakten).
- **Frische-Anzeige + Auto-Refresh** (alle 5 min) mit Stale-Warnung.
- Farb-Legende, **Dark Mode**, teilbare URLs (`#year/min/map`), Berlin-Zeit
  in der Anzeige (gespeichert wird immer UTC).

## Aufbau

```
.
├─ temp-leaderboard.sh        # holt DWD-Daten, erzeugt latest/tops/series/stations/stats + daily + history
├─ backfill.sh                # Backfill der Tageshistorie eines Jahres aus dem DWD-Klimaarchiv
├─ reference.sh               # Tages-Klimatologie -> reference.json + records.json (+ --history -> history/<wmo>.json)
├─ web/                       # Vite + TypeScript (kein Framework)
│  ├─ index.html
│  ├─ src/main.ts             # Rendering: Tabelle, Karte, Detail, Banderole, Theme, URL-State
│  ├─ src/style.css           # Oldschool-Almanach-Design + Dark Mode
│  ├─ src/funfacts.ts         # die Temperatur-Fakten der Banderole
│  └─ public/
│     ├─ germany.json         # Karten-Outline (statisches Asset)
│     └─ data/                # die ausgelieferten Daten (siehe unten)
└─ .github/workflows/update-and-deploy.yml
```

## Daten (`web/public/data/`)

| Datei | Inhalt | versioniert |
|---|---|---|
| `latest.json` | aktueller Snapshot (Rangliste „Jetzt") | ✅ |
| `tops.json` | Höchst-/Tiefstwerte je Station für Tag/Woche/Monat/Jahr | ✅ |
| `daily/<datum>.json` | Tages-Min/Max je Station | ✅ |
| `history.csv` | Roh-Log aller Messungen (dedupliziert) | ✅ |
| `reference.json` | Tages-Klimatologie 1991–2020 je Station (Normal-Verlauf + Referenzverteilung) | ✅ statisch |
| `history/<wmo>.json` | volle Tageshistorie je Station (oft Jahrzehnte zurück), on-demand geladen | ✅ statisch |
| `records.json` | Allzeit-Rekorde je Station (heißester/kältester Tag, wärmste Nacht, größte Spanne, längste Hitze-/Eisserie, meiste Hitzetage/Tropennächte) + nationale Bestjahre — speist „Allzeit"-Rangliste & Rekorde-Tafel („Gesamt") | ✅ statisch |
| `series.json`, `stations.json`, `stats.json` | abgeleitet (Verlauf, Koordinaten, Überblick) | ❌ neu erzeugt |
| `poi/`, `stations.cfg`, `de_stations.tsv`, `kl_hist_stations.txt` | Roh-Cache / Hilfsdateien | ❌ neu erzeugt |

Gespeichert wird durchgängig **UTC**; die Website rechnet für die Anzeige in
**Berlin-Zeit** um.

## Wie es funktioniert

- **`temp-leaderboard.sh`** lädt die aktuellen POI-Messwerte des DWD (eine CSV je
  Station), ermittelt die deutschen Stationen über den MOSMIX-Katalog und schreibt
  daraus `latest.json` + `tops.json` + `series.json` + `stations.json` + `stats.json`,
  führt die Tages-Min/Max in `daily/` fort und hängt neue Messungen dedupliziert an
  `history.csv` an. Gibt zusätzlich ein Leaderboard im Terminal aus
  (`--help` zeigt alle Optionen).
- **`backfill.sh [JAHR] [--gaps]`** füllt die Tageshistorie eines Jahres (Höchst-/
  Tiefstwerte) aus dem DWD-Klimaarchiv nach (Standard: aktuelles Jahr; `recent`
  deckt aktuelles + Vorjahr ab). Zuordnung der internen DWD-IDs zu den WMO-IDs über
  Koordinaten + Namens-Fallback. `--gaps` zieht nur für das Jahr fehlende Stationen nach.
- **`reference.sh [VON BIS]`** erzeugt **einmalig** `reference.json` **und `records.json`**:
  pro Station die Tages-Klimatologie der Normalperiode (Standard 1991–2020) aus dem
  `historical`-KL-Archiv (TXK/TNK) — geglättete Normalwerte je Kalendertag (Referenzkurve im
  Verlauf) plus die gepoolte Verteilung (Referenzkurve in „Verteilung Max/Min"); `records.json`
  enthält zusätzlich den Allzeit-Höchst/-Tiefstwert je Station (über das gesamte Archiv).
  Rate-limit-schonend: Verzeichnis-Listing nur 1×, kleine Parallelität (`--jobs`),
  Backoff-Retries, **resumebarer ZIP-Cache** (zweiter Lauf nach Abbruch lädt nur
  Fehlendes; `--refresh` erzwingt Neuladen). Eine Normal-Linie entsteht nur bei
  **≥ 20 abgedeckten Jahren** in der Periode (`REF_MIN_YEARS`); bei Teilabdeckung
  trägt das Label die tatsächliche Spanne. Nur nötig, wenn sich die Normalperiode ändert.
  Mit **`--history`** schreibt dasselbe Skript zusätzlich `history/<wmo>.json` (die
  volle Tageshistorie je Station, aus demselben ZIP-Cache) — vom Frontend on-demand
  beim Öffnen einer Station geladen, sodass Kalender/Verlauf/Verteilung die gesamte
  Historie zeigen, ohne `series.json` aufzublähen.
- **GitHub Actions** (`update-and-deploy.yml`) führt stündlich `temp-leaderboard.sh`
  aus, committet die aktualisierten Daten zurück, baut die Seite und deployt sie auf
  GitHub Pages.

## Lokal

```bash
./temp-leaderboard.sh             # Daten aktualisieren (-> web/public/data/)
npm --prefix web install          # einmalig
npm --prefix web run dev          # Dev-Server, http://localhost:5173
npm --prefix web run build        # Production-Build -> web/dist/
```

## Quellen

- Live-Messwerte: `opendata.dwd.de/weather/weather_reports/poi/`
- Stationskatalog: DWD MOSMIX
- Tageshistorie: `opendata.dwd.de/climate_environment/CDC/.../daily/kl/recent/`
- Normalwerte (Referenzlinien): `opendata.dwd.de/climate_environment/CDC/.../daily/kl/historical/`
- Karten-Outline: [deutschlandGeoJSON](https://github.com/isellsoap/deutschlandGeoJSON)
