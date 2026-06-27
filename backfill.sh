#!/usr/bin/env bash
#
# backfill.sh — Backfill der Tages-Höchst/Tiefstwerte für ein Jahr
#
# Verwendung:  ./backfill.sh [JAHR] [--gaps]
#   JAHR     vierstellig; Standard = aktuelles Jahr.
#   --gaps   nur Stationen, die für dieses Jahr noch keine Backfill-Daten haben
#            (z. B. nach Download-Abbrüchen). Idempotent, beliebig wiederholbar.
#
# Quelle: DWD-Klimaarchiv, tägliche KL-Werte (recent), je Station:
#   TXK = Tagesmaximum (2 m), TNK = Tagesminimum (2 m), -999 = fehlend.
#   Hinweis: 'recent' deckt ~die letzten 1,5 Jahre ab (aktuelles + Vorjahr).
#   Für ältere Jahre KL_BASE auf .../daily/kl/historical zeigen lassen.
#
# Das Klimaarchiv nutzt INTERNE DWD-IDs, unsere Live-Daten WMO-IDs (10xxx).
# Zuordnung: zuerst über Koordinaten (MOSMIX-Katalog, Grad-Minuten -> Dezimal,
# Schwelle ~2.5 km), sonst über Stationsnamen (nächste namensgleiche Station),
# sonst relaxte Koordinaten (~5 km). Ergebnis wird in daily/<datum>.json
# gemerged (Extremwerte), danach tops.json + latest.json neu gebaut.

set -u

GAPS=0
YEAR="$(date +%Y)"
for a in "$@"; do
  case "$a" in
    --gaps) GAPS=1 ;;
    [0-9][0-9][0-9][0-9]) YEAR="$a" ;;
    -h|--help) echo "Verwendung: $(basename "$0") [JAHR] [--gaps]"; exit 0 ;;
    *) echo "Unbekanntes Argument: $a" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="$ROOT/web/public/data"
KL_BASE="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/recent"
JOBS=6

if [ ! -s "$DATA/stations.cfg" ] || [ ! -s "$DATA/de_stations.tsv" ]; then
  echo "Fehlt: stations.cfg / de_stations.tsv — bitte zuerst ./temp-leaderboard.sh ausführen." >&2
  exit 1
fi

echo "» Backfill für $YEAR$([ "$GAPS" -eq 1 ] && echo ' (nur fehlende Stationen)')"

WORK="${TMPDIR:-/tmp}/kl_backfill_$$"
mkdir -p "$WORK/zips"
trap 'rm -rf "$WORK"' EXIT
XWALK="$WORK/crosswalk.tsv"
KL_STATIONS="$WORK/kl_stations.txt"

echo "» Lade KL-Stationsliste …"
curl -fsS --max-time 60 "$KL_BASE/KL_Tageswerte_Beschreibung_Stationen.txt" -o "$KL_STATIONS" \
  || { echo "Fehler beim Laden der KL-Stationsliste." >&2; exit 1; }

echo "» Baue Zuordnung WMO -> interne ID (Koordinaten + Namens-Fallback) …"
python3 - "$DATA" "$KL_STATIONS" "$XWALK" "$YEAR" "$GAPS" <<'PY'
import sys, os, io, math, re, json, glob

data_dir, kl_path, out_path, year, gaps = (
    sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5] == "1")

def ddmm(x):
    d = math.floor(x); return d + (x - d) * 100.0 / 60.0

def norm(s):
    s = s.upper().replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
    return re.sub(r"[^A-Z0-9]", "", s)

# WMO-Stationen + Namen
wmo = {}
with io.open(os.path.join(data_dir, "de_stations.tsv"), encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 2:
            wmo[p[0]] = p[1]

# WMO-Koordinaten (Grad-Minuten -> Dezimalgrad)
coord = {}
with io.open(os.path.join(data_dir, "stations.cfg"), encoding="latin-1") as f:
    for ln in f:
        t = ln.split()
        if len(t) >= 5 and t[0] in wmo:
            try:
                coord[t[0]] = (ddmm(float(t[-3])), ddmm(float(t[-2])))
            except ValueError:
                pass

# Zielmenge: bei --gaps nur Stationen ohne Backfill-Daten FÜR DIESES JAHR
targets = [s for s in wmo if s in coord]
if gaps:
    covered = set()
    ystr = "%04d-" % year
    for fn in glob.glob(os.path.join(data_dir, "daily", "*.json")):
        if not os.path.basename(fn).startswith(ystr):
            continue
        try:
            doc = json.load(io.open(fn, encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for sid, e in doc.get("stations", {}).items():
            if e.get("source") == "dwd-kl":
                covered.add(sid)
    targets = [s for s in targets if s not in covered]

# Aktive KL-Stationen im Zieljahr: (internal, lat, lon, normname)
kl = []
with io.open(kl_path, encoding="latin-1") as f:
    for i, ln in enumerate(f):
        if i < 2:
            continue
        t = ln.split()
        if len(t) < 7:
            continue
        try:
            internal, bis = t[0], int(t[2])
            lat, lon = float(t[4]), float(t[5])
        except ValueError:
            continue
        if bis < year * 10000 + 101:
            continue
        kl.append((internal, lat, lon, norm(" ".join(t[6:-2]))))

matched, still = [], []
for sid in targets:
    lat, lon = coord[sid]
    clat = math.cos(math.radians(lat))
    wn = norm(wmo[sid])
    scored = sorted((math.hypot(lat - klat, (lon - klon) * clat), internal, kn)
                    for internal, klat, klon, kn in kl)
    near = scored[0]
    if near[0] <= 0.025:                                   # sichere Koordinaten-Zuordnung
        matched.append((sid, near[1], wmo[sid])); continue
    nm = [c for c in scored if c[0] < 0.3 and len(wn) >= 4
          and (c[2].startswith(wn) or wn.startswith(c[2]))]
    if nm:                                                 # Namens-Fallback (nächste namensgleiche)
        matched.append((sid, nm[0][1], wmo[sid]))
    elif near[0] <= 0.05:                                  # relaxte Koordinaten-Zuordnung
        matched.append((sid, near[1], wmo[sid]))
    else:
        still.append((wmo[sid], near[0]))

with io.open(out_path, "w", encoding="utf-8") as f:
    for sid, internal, name in sorted(matched):
        f.write("%s\t%s\t%s\n" % (sid, internal, name))

scope = "fehlende" if gaps else "alle"
print("   %s Stationen: %d  ->  zugeordnet: %d  (ohne KL-Station: %d)"
      % (scope, len(targets), len(matched), len(still)), file=sys.stderr)
for name, d in sorted(still):
    print("     ohne Match: %-22s (naechste KL %.3f Grad)" % (name, d), file=sys.stderr)
PY

if [ ! -s "$XWALK" ]; then
  echo "» Nichts zu tun (keine zuzuordnenden Stationen)."; exit 0
fi
N="$(wc -l < "$XWALK" | tr -d ' ')"

echo "» Lade KL-Tageswerte ($N ZIPs, parallel x$JOBS, mit Retry) …"
# kleiner Downloader (WORK/KL_BASE eingebacken); leere/fehlerhafte ZIPs verwerfen
cat > "$WORK/dl.sh" <<EOF
#!/bin/sh
o="$WORK/zips/\$1.zip"
curl -fsS --retry 3 --retry-delay 1 --max-time 90 "$KL_BASE/tageswerte_KL_\$1_akt.zip" -o "\$o" 2>/dev/null || true
[ -s "\$o" ] || rm -f "\$o"
EOF
chmod +x "$WORK/dl.sh"
cut -f2 "$XWALK" | sort -u | xargs -P "$JOBS" -n1 "$WORK/dl.sh"
GOT=$(ls "$WORK/zips" | wc -l | tr -d ' ')
echo "  gültige ZIPs: $GOT / $N"

echo "» Parse TXK/TNK & merge in daily/*.json …"
python3 - "$DATA" "$XWALK" "$WORK/zips" "$YEAR" <<'PY'
import sys, os, io, json, glob, zipfile

data_dir, xwalk_path, zips_dir, year = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
daily_dir = os.path.join(data_dir, "daily")
os.makedirs(daily_dir, exist_ok=True)

xw = {}
with io.open(xwalk_path, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 3:
            xw[p[1]] = (p[0], p[2])

lo, hi = year * 10000 + 101, year * 10000 + 1231

def num(x):
    x = x.strip()
    try:
        v = float(x)
    except ValueError:
        return None
    return None if v <= -999 else v

by_date, seen = {}, set()
for zp in glob.glob(os.path.join(zips_dir, "*.zip")):
    internal = os.path.basename(zp)[:-4]
    if internal not in xw:
        continue
    w, name = xw[internal]
    try:
        zf = zipfile.ZipFile(zp)
    except (zipfile.BadZipFile, OSError):
        continue
    member = next((n for n in zf.namelist()
                   if os.path.basename(n).startswith("produkt_klima_tag")), None)
    if not member:
        continue
    for ln in zf.read(member).decode("latin-1", "replace").splitlines()[1:]:
        fields = ln.split(";")
        if len(fields) < 17:
            continue
        try:
            dt = int(fields[1])
        except ValueError:
            continue
        if dt < lo or dt > hi:
            continue
        txk, tnk = num(fields[15]), num(fields[16])
        if txk is None and tnk is None:
            continue
        ds = "%04d-%02d-%02d" % (dt // 10000, (dt // 100) % 100, dt % 100)
        by_date.setdefault(ds, []).append((w, name, txk, tnk))
        seen.add(w)

days = 0
for ds, items in by_date.items():
    path = os.path.join(daily_dir, ds + ".json")
    doc = {"date": ds, "stations": {}}
    if os.path.exists(path):
        try:
            doc = json.load(io.open(path, encoding="utf-8"))
            doc.setdefault("stations", {})
        except (ValueError, OSError):
            doc = {"date": ds, "stations": {}}
    st = doc["stations"]
    for w, name, txk, tnk in items:
        e = st.get(w)
        if e is None:
            e = {"name": name, "source": "dwd-kl"}
            if txk is not None:
                e["max_c"], e["max_obs_utc"] = txk, ds
            if tnk is not None:
                e["min_c"], e["min_obs_utc"] = tnk, ds
            st[w] = e
        else:
            e.setdefault("name", name)
            if txk is not None and (e.get("max_c") is None or txk > e["max_c"]):
                e["max_c"], e["max_obs_utc"] = txk, ds
            if tnk is not None and (e.get("min_c") is None or tnk < e["min_c"]):
                e["min_c"], e["min_obs_utc"] = tnk, ds
    doc["date"] = ds
    json.dump(doc, io.open(path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2, sort_keys=True)
    days += 1

print("   gemergt: %d Stationen, %d Tagesdateien" % (len(seen), days), file=sys.stderr)

# zugeordnet, aber ohne Temperaturwerte im KL-Archiv (z. B. Militaerflugplaetze)
no_temp = sorted(name for internal, (w, name) in xw.items() if w not in seen)
if no_temp:
    s = ", ".join(no_temp[:10])
    print("   ohne Temperatur im KL-Archiv: %d (%s%s)"
          % (len(no_temp), s, " …" if len(no_temp) > 10 else ""), file=sys.stderr)
PY

echo "» Baue tops.json & latest.json neu …"
"$ROOT/temp-leaderboard.sh" --top 1 >/dev/null 2>&1 || true

echo "Fertig — Backfill $YEAR abgeschlossen."
