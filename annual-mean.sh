#!/usr/bin/env bash
# Holt das offizielle DWD-Gebietsmittel der Jahres-Lufttemperatur für Deutschland und schreibt es
# nach web/public/data/annual-mean.json ({years, mean}). Speist die Jahresmittel-Kurve oben auf der
# Rekorde-Seite; Trendlinie & 30-J.-Mittel berechnet das Frontend selbst.
#
# Läuft in der Pipeline bei jedem Lauf mit (winzige Datei, ändert sich real nur jährlich). Robust:
# bei Download-/Parse-Fehler bleibt die bestehende annual-mean.json unangetastet (Exit 0, kein Abbruch
# des Deploys).
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/web/public/data/annual-mean.json"
URL="https://opendata.dwd.de/climate_environment/CDC/regional_averages_DE/annual/air_temperature_mean/regional_averages_tm_year.txt"

TMP="$OUT.download"        # Sibling im Repo-Datenordner (überall schreibbar, kein System-Temp)
trap 'rm -f "$TMP"' EXIT
if ! curl -fsS --retry 3 --max-time 60 "$URL" -o "$TMP"; then
  echo "annual-mean: DWD-Download fehlgeschlagen – annual-mean.json bleibt unverändert." >&2
  exit 0
fi

python3 - "$TMP" "$OUT" <<'PY'
import json, sys
src, out = sys.argv[1], sys.argv[2]
with open(src, encoding='latin-1') as f:
    lines = f.readlines()
# Kopfzeile mit der Spalte „Deutschland" finden (erste Spalte = „Jahr")
hdr = start = None
for i, l in enumerate(lines):
    cols = l.rstrip(';\n').split(';')
    if cols and cols[0].strip() == 'Jahr' and 'Deutschland' in cols:
        hdr, start = cols, i + 1
        break
if hdr is None:
    sys.stderr.write("annual-mean: 'Deutschland'-Spalte nicht gefunden – abgebrochen.\n")
    sys.exit(0)          # bestehende Datei behalten
di = hdr.index('Deutschland')
years, mean = [], []
for l in lines[start:]:
    p = l.rstrip(';\n').split(';')
    if len(p) <= di:
        continue
    try:
        years.append(int(p[0])); mean.append(round(float(p[di]), 2))
    except ValueError:
        continue
if len(years) < 50:
    sys.stderr.write("annual-mean: zu wenige Jahre (%d) – abgebrochen.\n" % len(years))
    sys.exit(0)
with open(out, 'w', encoding='utf-8') as f:
    json.dump({"source": "DWD Gebietsmittel Deutschland", "years": years, "mean": mean},
              f, ensure_ascii=False, separators=(',', ':'))
sys.stderr.write("annual-mean.json: %d Jahre (%d–%d) vom DWD.\n" % (len(years), years[0], years[-1]))
PY