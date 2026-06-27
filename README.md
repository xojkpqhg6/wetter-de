# 🌡 Temperatur-Leaderboard Deutschland

Live-Rangliste der Lufttemperatur aller DWD-Messstationen in Deutschland —
plus Tages-, Wochen-, Monats- und Jahreswerte, Karte und Stationsverlauf.
Daten vom [Deutschen Wetterdienst](https://opendata.dwd.de), Website als
statische Vanilla-TypeScript-Seite (kein Framework), stündlich automatisch
aktualisiert per GitHub Actions und über GitHub Pages ausgeliefert.

## Features

- **Rangliste** aller ~200 Stationen — „Jetzt" (Live) sowie Höchst-/Tiefstwerte
  für **Tag / Woche / Monat / Jahr**.
- **Tabelle & Deutschlandkarte** (Stationen als Punkte, nach Temperatur eingefärbt).
- **Stationsdetail** per Klick: Sparkline des 2026-Verlaufs (Tagesmax/-min),
  Jahres-Höchst/-Tiefst, Badge bei neuem Jahresrekord.
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
├─ backfill-2026.sh           # einmaliger Backfill der 2026-Tageshistorie aus dem DWD-Klimaarchiv
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
| `series.json`, `stations.json`, `stats.json` | abgeleitet (Verlauf, Koordinaten, Überblick) | ❌ neu erzeugt |
| `poi/`, `stations.cfg`, `de_stations.tsv` | Roh-Cache / Hilfsdateien | ❌ neu erzeugt |

Gespeichert wird durchgängig **UTC**; die Website rechnet für die Anzeige in
**Berlin-Zeit** um.

## Wie es funktioniert

- **`temp-leaderboard.sh`** lädt die aktuellen POI-Messwerte des DWD (eine CSV je
  Station), ermittelt die deutschen Stationen über den MOSMIX-Katalog und schreibt
  daraus `latest.json` + `tops.json` + `series.json` + `stations.json` + `stats.json`,
  führt die Tages-Min/Max in `daily/` fort und hängt neue Messungen dedupliziert an
  `history.csv` an. Gibt zusätzlich ein Leaderboard im Terminal aus
  (`--help` zeigt alle Optionen).
- **`backfill-2026.sh`** füllt einmalig die Tageshistorie 2026 (Höchst-/Tiefstwerte)
  aus dem DWD-Klimaarchiv nach. Zuordnung der internen DWD-IDs zu den WMO-IDs über
  Koordinaten + Namens-Fallback. `--gaps` zieht nur fehlende Stationen nach.
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
- Karten-Outline: [deutschlandGeoJSON](https://github.com/isellsoap/deutschlandGeoJSON)
