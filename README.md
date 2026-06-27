# 🌡 Temperatur-Leaderboard Deutschland

Live-Rangliste der Lufttemperatur aller DWD-Messstationen in Deutschland —
plus Tages-, Wochen-, Monats- und Jahres-Höchstwerte. Daten vom
[Deutschen Wetterdienst](https://opendata.dwd.de), Website als statische
Vanilla-TypeScript-Seite, automatisch aktualisiert per GitHub Actions und
ausgeliefert über GitHub Pages.

## Aufbau

```
.
├─ temp-leaderboard.sh        # holt DWD-Daten, schreibt latest.json / tops.json / history / daily
├─ backfill-2026.sh           # EINMALIG: Tageshistorie 2026 aus dem DWD-Klimaarchiv
├─ web/                       # Vite + TypeScript (kein Framework)
│  ├─ src/main.ts, src/style.css
│  ├─ index.html
│  └─ public/data/            # die ausgelieferten Daten (siehe unten)
└─ .github/workflows/update-and-deploy.yml
```

### Daten unter `web/public/data/`

| Datei | Inhalt | versioniert? |
|---|---|---|
| `latest.json` | aktueller Snapshot (Rangliste „Jetzt") | ✅ |
| `tops.json` | Höchstwerte je Station: Tag / Woche / Monat / Jahr | ✅ |
| `daily/<datum>.json` | Tages-Min/Max je Station | ✅ |
| `history.csv` | Roh-Log aller Messungen (dedupliziert) | ✅ |
| `poi/`, `stations.cfg`, `de_stations.tsv` | Roh-Cache / Hilfsdateien | ❌ (werden neu erzeugt) |

Gespeichert wird immer **UTC**; die Website zeigt **Berlin-Zeit** (Umrechnung im Browser).

## So bringst du es online

1. **Repo anlegen** (leer, auf GitHub) und lokal pushen:
   ```bash
   git init -b main
   git add .
   git commit -m "init: temperatur-leaderboard"
   git remote add origin git@github.com:<user>/<repo>.git
   git push -u origin main
   ```
2. **GitHub Pages aktivieren**: Repo → *Settings* → *Pages* →
   *Build and deployment* → **Source: GitHub Actions**.
   (Einmaliger Klick — danach übernimmt der Workflow alles.)
3. Fertig. Der Workflow läuft beim Push, danach **stündlich**, und nach
   wenigen Minuten ist die Seite unter
   `https://<user>.github.io/<repo>/` erreichbar.

> Tokens musst du nichts einrichten — der Workflow nutzt den automatischen
> `GITHUB_TOKEN`. Commits des Bots lösen **keinen** erneuten Lauf aus
> (kein Endlos-Loop).

### Optional: Historie vor dem ersten Push seeden

Damit Woche/Monat/Jahr von Anfang an gefüllt sind, einmal lokal:
```bash
./temp-leaderboard.sh   # Live-Snapshot + erstes daily/
./backfill-2026.sh      # Tageshistorie 2026 aus dem Klimaarchiv
```
Die so erzeugten `daily/*.json` werden mitcommittet. (Ist in diesem
Repo bereits geschehen.)

## Lokal entwickeln

```bash
./temp-leaderboard.sh              # Daten aktualisieren
npm --prefix web install          # einmalig
npm --prefix web run dev          # Dev-Server (http://localhost:5173)
npm --prefix web run build        # Production-Build -> web/dist/
```

`temp-leaderboard.sh --help` zeigt alle Optionen (`--cold`, `--top N`, …).

## Automatisierung (GitHub Actions)

[`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml)
macht pro Lauf:

1. `temp-leaderboard.sh` ausführen → `latest.json` + `tops.json` + `daily/` + `history.csv` aktualisieren
2. geänderte Daten zurück-committen (`web/public/data`)
3. Site bauen (`npm ci && npm run build`)
4. auf GitHub Pages deployen

Auslöser: stündlich (`cron`), bei Push auf `main`, oder manuell
(*Actions* → *Update & Deploy* → *Run workflow*).

## Quellen

- Live-Messwerte: `opendata.dwd.de/weather/weather_reports/poi/`
- Stationskatalog: DWD MOSMIX
- Tageshistorie: `opendata.dwd.de/climate_environment/CDC/.../daily/kl/recent/`
