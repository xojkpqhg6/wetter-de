#!/usr/bin/env bash
#
# reference.sh — Tages-Klimatologie als Referenzlinien (Normalperiode, Standard 1991–2020)
#
# Quelle: DWD-Klimaarchiv, tägliche KL-Werte (HISTORICAL), je Station:
#   TXK = Tagesmaximum (2 m), TNK = Tagesminimum (2 m), -999 = fehlend.
#   .../daily/kl/historical deckt die volle Stationshistorie ab (oft Jahrzehnte).
#
# Erzeugt EINMALIG (Normalperiode ist fix) web/public/data/reference.json:
#   {
#     "period": "1991-2020",
#     "stations": {
#       "<wmo>": {
#         "max": [null, v1 … v366],   // geglättete Tages-Normalwerte des Tagesmaximums
#         "min": [null, v1 … v366],   // dito Tagesminimum  (Index = Kalendertag 1…366)
#         "histMax": { "<°C>": tage }, // gepoolte Verteilung der Tagesmaxima 1991–2020
#         "histMin": { "<°C>": tage }  // dito Tagesminima  (ganze 1-°C-Bins)
#       }, …
#     }
#   }
#
# Das Klimaarchiv nutzt INTERNE DWD-IDs, unsere Live-Daten WMO-IDs (10xxx).
# Zuordnung wie in backfill.sh: Koordinaten (MOSMIX-Katalog) + Namens-Fallback.
#
# Rate-limit-schonend: Verzeichnis-Listing nur 1×, kleine Parallelität, Backoff-
# Retries, resumebarer ZIP-Cache (zweiter Lauf nach Abbruch lädt nur Fehlendes).
#
# Verwendung:  ./reference.sh [VON BIS] [--jobs N] [--refresh]
#   VON BIS    Normalperiode (vierstellig), Standard: 1991 2020
#   --jobs N   parallele Downloads (Standard: 4 — bewusst niedrig)
#   --refresh  Beschreibung & ZIP-Cache neu laden (ignoriert vorhandenen Cache)
#
# Bewusst portabel (läuft auf macOS-bash 3.2, keine assoz. Arrays).

set -u

FROM=1991
TO=2020
JOBS=4
REFRESH=0
HISTORY=0                          # zusätzlich history/<wmo>.json (volle Tageshistorie) schreiben
RECENT=0                           # --recent: nur das aktuelle KL-Produkt laden & in records/timeline mergen
WINDOW="${REF_WINDOW:-7}"          # Glättungsfenster ±N Kalendertage
MIN_SAMPLES="${REF_MIN_SAMPLES:-50}"  # min. Messwerte je Fenster, sonst null
MIN_STATION="${REF_MIN_STATION:-1500}" # min. Messwerte je Station, sonst keine Referenz
MIN_YEARS="${REF_MIN_YEARS:-20}"   # min. abgedeckte Jahre in der Periode, sonst keine Normal-Linie

YEARS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --jobs)    JOBS="${2:-4}"; shift 2 ;;
    --refresh) REFRESH=1; shift ;;
    --history) HISTORY=1; shift ;;
    --recent)  RECENT=1; shift ;;
    -h|--help)
      echo "Verwendung: $(basename "$0") [VON BIS] [--jobs N] [--refresh] [--history] [--recent]"
      echo "  --history  zusätzlich web/public/data/history/<wmo>.json (volle Tageshistorie,"
      echo "             on-demand vom Frontend geladen) aus demselben ZIP-Cache schreiben."
      echo "  --recent   NUR das tägliche 'recent'-KL-Produkt laden (kein Verzeichnis-Listing,"
      echo "             ephemerer Cache) und neue Werte in records.json + timeline.json mergen."
      echo "             Fängt aktuelle Rekorde (auch reiner Klimastationen) ohne Vollauf ab;"
      echo "             lässt reference.json unangetastet. Für den täglichen CI-Lauf gedacht."
      exit 0 ;;
    [0-9][0-9][0-9][0-9]) YEARS+=("$1"); shift ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1 ;;
  esac
done
if [ "${#YEARS[@]}" -eq 2 ]; then FROM="${YEARS[0]}"; TO="${YEARS[1]}"
elif [ "${#YEARS[@]}" -ne 0 ]; then echo "Bitte VON und BIS angeben (zwei Jahre)." >&2; exit 1; fi
[ "$FROM" -le "$TO" ] || { echo "VON muss <= BIS sein." >&2; exit 1; }

# Fenster für die WMO->intern-Zuordnung (welche KL-Stationen berücksichtigt werden).
# Vollauf: Normalperiode. --recent: nur zuletzt aktive Stationen (letzte ~2 Jahre).
XW_FROM="$FROM"; XW_TO="$TO"
if [ "$RECENT" -eq 1 ]; then
  HISTORY=0                          # im recent-Modus keine history/-Dateien (nur Kurzfenster)
  NOW_Y="$(date -u +%Y)"
  XW_FROM="$((NOW_Y - 2))"; XW_TO="$NOW_Y"
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="$ROOT/web/public/data"
KL_BASE="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/historical"
CACHE="${TMPDIR:-/tmp}/dwd_kl_hist_cache"   # stabiler, resumebarer ZIP-Cache
OUT="$DATA/reference.json"
OUT_RECORDS="$DATA/records.json"
OUT_TIMELINE="$DATA/timeline.json"
TL_START="${REF_TIMELINE_START:-1936}"   # Startjahr der Zeitreihe (davor zu dünne Abdeckung)

if [ ! -s "$DATA/stations.cfg" ] || [ ! -s "$DATA/de_stations.tsv" ]; then
  echo "Fehlt: stations.cfg / de_stations.tsv — bitte zuerst ./temp-leaderboard.sh ausführen." >&2
  exit 1
fi

echo "» Referenzperiode $FROM–$TO  (Glättung ±${WINDOW} Tage, Cache: $CACHE)"
mkdir -p "$CACHE"

WORK="${TMPDIR:-/tmp}/kl_reference_$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT
XWALK="$WORK/crosswalk.tsv"        # wmo \t internal \t name
KL_STATIONS="$DATA/kl_hist_stations.txt"
DLLIST="$WORK/downloads.txt"       # "internal dateiname" (Dateinamen ohne Leerzeichen)

# --recent: anderes Produkt, ephemerer Cache (Recent-ZIPs ändern sich täglich -> nie
# aus altem Cache bedienen), eigene, stets frische Stationsbeschreibung.
if [ "$RECENT" -eq 1 ]; then
  KL_BASE="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/recent"
  CACHE="$WORK/recent_cache"
  KL_STATIONS="$WORK/kl_recent_stations.txt"
  mkdir -p "$CACHE"                  # ephemerer Cache erst hier anlegen (CACHE oben überschrieben)
fi

# ---------------------------------------------------------------------------
# 1) Historische KL-Stationsliste (Beschreibung) — 7 Tage Cache
# ---------------------------------------------------------------------------
if [ "$REFRESH" -eq 1 ] || [ ! -s "$KL_STATIONS" ] || [ -z "$(find "$KL_STATIONS" -mtime -7 2>/dev/null)" ]; then
  echo "» Lade KL-Stationsliste ($([ "$RECENT" -eq 1 ] && echo recent || echo historical)) …"
  curl -fsS --retry 5 --retry-all-errors --max-time 90 \
    "$KL_BASE/KL_Tageswerte_Beschreibung_Stationen.txt" -o "$KL_STATIONS.tmp" \
    && mv "$KL_STATIONS.tmp" "$KL_STATIONS" \
    || { echo "Fehler beim Laden der KL-Stationsliste." >&2; rm -f "$KL_STATIONS.tmp"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 2) Zuordnung WMO -> interne ID (Koordinaten + Namens-Fallback, wie backfill.sh)
#    KL-Stationen müssen die Normalperiode überlappen (von<=BIS, bis>=VON).
# ---------------------------------------------------------------------------
echo "» Baue Zuordnung WMO -> interne ID …"
python3 - "$DATA" "$KL_STATIONS" "$XWALK" "$XW_FROM" "$XW_TO" <<'PY'
import sys, os, io, math, re

data_dir, kl_path, out_path, frm, to = (
    sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
lo_d, hi_d = frm * 10000 + 101, to * 10000 + 1231

def ddmm(x):
    d = math.floor(x); return d + (x - d) * 100.0 / 60.0

def norm(s):
    s = s.upper().replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
    return re.sub(r"[^A-Z0-9]", "", s)

wmo = {}
with io.open(os.path.join(data_dir, "de_stations.tsv"), encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 2:
            wmo[p[0]] = p[1]

coord = {}
with io.open(os.path.join(data_dir, "stations.cfg"), encoding="latin-1") as f:
    for ln in f:
        t = ln.split()
        if len(t) >= 5 and t[0] in wmo:
            try:
                coord[t[0]] = (ddmm(float(t[-3])), ddmm(float(t[-2])))
            except ValueError:
                pass

# KL-Stationen, deren Aufzeichnungszeitraum die Normalperiode überlappt
kl = []   # (internal, lat, lon, normname, rawname)
with io.open(kl_path, encoding="latin-1") as f:
    for i, ln in enumerate(f):
        if i < 2:
            continue
        t = ln.split()
        if len(t) < 7:
            continue
        try:
            internal, von, bis = t[0], int(t[1]), int(t[2])
            lat, lon = float(t[4]), float(t[5])
        except ValueError:
            continue
        if von > hi_d or bis < lo_d:        # kein Überlapp mit [VON, BIS]
            continue
        raw = " ".join(t[6:-2])
        kl.append((internal, lat, lon, norm(raw), raw))

targets = [s for s in wmo if s in coord]
matched, still, matched_int = [], [], set()   # matched: (key, internal, name, poi)
for sid in targets:
    lat, lon = coord[sid]
    clat = math.cos(math.radians(lat))
    wn = norm(wmo[sid])
    scored = sorted((math.hypot(lat - klat, (lon - klon) * clat), internal, kn)
                    for internal, klat, klon, kn, raw in kl)
    if not scored:
        still.append((wmo[sid], 9.9)); continue
    near = scored[0]
    hit = None
    if near[0] <= 0.025:
        hit = near[1]
    else:
        nm = [c for c in scored if c[0] < 0.3 and len(wn) >= 4
              and (c[2].startswith(wn) or wn.startswith(c[2]))]
        if nm:
            hit = nm[0][1]
        elif near[0] <= 0.05:
            hit = near[1]
    if hit:
        matched.append((sid, hit, wmo[sid], 1)); matched_int.add(hit)
    else:
        still.append((wmo[sid], near[0]))

# alle übrigen aktiven KL-Stationen als reine Klimastationen (Key = interne ID, kein POI)
climate = [(internal, internal, raw, 0)
           for internal, lat, lon, nn, raw in kl if internal not in matched_int]

with io.open(out_path, "w", encoding="utf-8") as f:
    for key, internal, name, poi in sorted(matched) + sorted(climate):
        f.write("%s\t%s\t%s\t%d\n" % (key, internal, name, poi))

print("   POI-Stationen: %d  ->  zugeordnet: %d  (ohne KL-Station: %d)  ·  reine Klimastationen: %d"
      % (len(targets), len(matched), len(still), len(climate)), file=sys.stderr)
PY

[ -s "$XWALK" ] || { echo "» Nichts zuzuordnen — Abbruch." >&2; exit 1; }

# ---------------------------------------------------------------------------
# 3) Dateinamen auflösen.
#    Vollauf: das historical-Listing trägt den Zeitbereich im Namen
#      (tageswerte_KL_<id>_<von>_<bis>_hist.zip) -> EINMAL das Verzeichnis lesen.
#    --recent: der Name ist fest (tageswerte_KL_<id>_akt.zip) -> kein Listing nötig.
# ---------------------------------------------------------------------------
if [ "$RECENT" -eq 1 ]; then
  echo "» Löse recent-Dateinamen auf (fest, kein Listing) …"
  python3 - "$XWALK" "$DLLIST" <<'PY'
import sys, io
xwalk, out = sys.argv[1], sys.argv[2]
want = set()
with io.open(xwalk, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 2:
            want.add(p[1])                 # interne ID
n = 0
with io.open(out, "w", encoding="utf-8") as f:
    for internal in sorted(want):
        fn = "tageswerte_KL_%05d_akt.zip" % int(internal)
        f.write("%s %s\n" % (internal, fn)); n += 1
print("   recent-Dateien angefragt: %d (nicht vorhandene -> 404, werden übersprungen)" % n,
      file=sys.stderr)
PY
else
echo "» Hole Verzeichnis-Listing (1 Request) & löse Dateinamen auf …"
LISTING="$WORK/listing.html"
curl -fsS --retry 5 --retry-all-errors --max-time 90 "$KL_BASE/" -o "$LISTING" \
  || { echo "Fehler beim Laden des Verzeichnis-Listings." >&2; exit 1; }

python3 - "$XWALK" "$LISTING" "$DLLIST" <<'PY'
import sys, io, re
xwalk, listing, out = sys.argv[1], sys.argv[2], sys.argv[3]

want = set()
with io.open(xwalk, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 2:
            want.add(p[1])                 # interne ID

byid = {}                                  # kanonische ID (ohne führende Nullen) -> Dateiname
pat = re.compile(r"tageswerte_KL_(\d+)_\d+_\d+_hist\.zip")
with io.open(listing, encoding="latin-1") as f:
    for m in pat.finditer(f.read()):
        byid[str(int(m.group(1)))] = m.group(0)   # letzter Treffer gewinnt

n = 0
with io.open(out, "w", encoding="utf-8") as f:
    for internal in sorted(want):
        fn = byid.get(str(int(internal)))  # Lookup normalisiert, ID bleibt im Original
        if fn:
            f.write("%s %s\n" % (internal, fn)); n += 1

miss = sorted(s for s in want if str(int(s)) not in byid)
print("   Dateien gefunden: %d / %d" % (n, len(want)), file=sys.stderr)
if miss:
    print("   ohne hist-Datei: %d (%s%s)"
          % (len(miss), ", ".join(miss[:8]), " …" if len(miss) > 8 else ""), file=sys.stderr)
PY
fi

[ -s "$DLLIST" ] || { echo "» Keine Dateien zu laden — Abbruch." >&2; exit 1; }
N="$(wc -l < "$DLLIST" | tr -d ' ')"

# ---------------------------------------------------------------------------
# 4) ZIPs laden — resumebarer Cache, kleine Parallelität, Backoff-Retries.
#    Vorhandene, nicht-leere ZIPs werden übersprungen (zweiter Lauf = Resume).
# ---------------------------------------------------------------------------
if [ "$REFRESH" -eq 1 ]; then echo "» --refresh: leere ZIP-Cache"; rm -f "$CACHE"/*.zip 2>/dev/null; fi
if [ "$RECENT" -eq 1 ]; then
  echo "» Lade recent-KL ($N ZIPs, parallel x$JOBS, Backoff; 404 = keine Station) …"
else
  echo "» Lade KL-Historie ($N ZIPs, parallel x$JOBS, Backoff, Cache-Resume) …"
fi
cat > "$WORK/dl.sh" <<EOF
#!/bin/sh
# \$1 = interne ID, \$2 = Dateiname
o="$CACHE/\$1.zip"
[ -s "\$o" ] && exit 0                       # schon im Cache -> nicht erneut laden
# kleiner, jitterender Vorlauf entzerrt die Last (rate-limit-schonend)
sleep "0.\$(( (\$\$ % 7) + 1 ))"
curl -fsS --retry 6 --retry-all-errors --retry-max-time 300 --max-time 120 \\
     "$KL_BASE/\$2" -o "\$o.part" 2>/dev/null && mv "\$o.part" "\$o" || rm -f "\$o.part"
EOF
chmod +x "$WORK/dl.sh"
# je Zeile "internal dateiname" -> beide Felder als Argumente an dl.sh
xargs -P "$JOBS" -L1 "$WORK/dl.sh" < "$DLLIST"

GOT=0
while read -r internal fn; do [ -s "$CACHE/$internal.zip" ] && GOT=$((GOT+1)); done < "$DLLIST"
echo "  im Cache: $GOT / $N"
[ "$GOT" -gt 0 ] || { echo "» Keine ZIPs geladen (Rate-Limit?). Skript erneut starten — der Cache setzt fort." >&2; exit 1; }

# ---------------------------------------------------------------------------
# 5) TXK/TNK parsen, je Kalendertag mitteln + glätten, Verteilung poolen -> JSON
# ---------------------------------------------------------------------------
echo "» Parse TXK/TNK, mittel je Kalendertag (geglättet) & poole Verteilung …"
python3 - "$XWALK" "$DLLIST" "$CACHE" "$OUT" "$FROM" "$TO" "$WINDOW" "$MIN_SAMPLES" "$MIN_STATION" "$OUT_RECORDS" "$MIN_YEARS" "$OUT_TIMELINE" "$TL_START" "$RECENT" <<'PY'
import sys, os, io, json, zipfile, datetime

xwalk, dllist, cache, out_path, frm, to, window, min_samples, min_station, out_records, min_years, out_timeline, tl_start, recent = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4],
    int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7]), int(sys.argv[8]), int(sys.argv[9]),
    sys.argv[10], int(sys.argv[11]), sys.argv[12], int(sys.argv[13]), int(sys.argv[14]))

# interne ID -> Key (WMO für POI, interne ID für reine Klimastationen) + Namen + POI-Set
internal2wmo = {}
names = {}       # Key -> Name (nur reine Klimastationen; POI-Namen kommen aus coords)
poi_keys = set() # Keys mit POI-Bezug (bekommen reference.json-Normal + history/)
with io.open(xwalk, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 2:
            internal2wmo[p[1]] = p[0]
            if len(p) >= 4 and p[3] == "1":
                poi_keys.add(p[0])
            elif len(p) >= 3:
                names[p[0]] = p[2]

internals = []
with io.open(dllist, encoding="utf-8") as f:
    for ln in f:
        p = ln.split()
        if p:
            internals.append(p[0])

def num(x):
    x = x.strip()
    try:
        v = float(x)
    except ValueError:
        return None
    return None if v <= -999 else v

def rnd(v):                       # wie JS Math.round (halbe Werte Richtung +∞)
    import math
    return int(math.floor(v + 0.5))

# pro WMO: Tagessummen/-zahlen je Kalendertag (1..366) + gepoolte Histogramme
N = 367
HEAT_THRS = (30, 35, 40, 45) # Hitze- / Wüsten- / Extreme-Hitze- / Gluttage (Tagesmaximum)
NIGHT_THRS = (20, 25, 30)   # Tropennacht / Wüstennacht / Super-Tropennacht (Tagesminimum bleibt darüber)

def new_streak():
    return {"run": 0, "start": None, "best": 0, "beg": None, "end": None}

def upd_streak(st, active, o, cons):
    if active:
        if cons and st["run"] >= 1: st["run"] += 1
        else: st["run"] = 1; st["start"] = o
        if st["run"] > st["best"]:
            st["best"] = st["run"]; st["beg"] = st["start"]; st["end"] = o
    else:
        st["run"] = 0

def new_acc():
    return {"smax": [0.0]*N, "cmax": [0]*N, "smin": [0.0]*N, "cmin": [0]*N,
            "hmax": {}, "hmin": {}, "n": 0, "years": set(),
            # Allzeit-Rekorde je Station (ungefiltert, ganze Historie) -> records.json
            "rmx": None, "rmxd": "", "rmn": None, "rmnd": "",       # heißester Tag / kältester Tag
            "rnight": None, "rnightd": "",                          # wärmste Nacht (max TNK)
            "days": {t: {} for t in HEAT_THRS},                    # heiße Tage je Jahr, je Schwelle
            "nights": {t: {} for t in NIGHT_THRS},                 # warme Nächte je Jahr, je Schwelle
            "fy": None, "ly": None,                                # erstes/letztes Jahr mit Daten (Panel)
            "hit": {t: {} for t in HEAT_THRS},                     # Tage-Treffer: Schwelle -> Jahr -> Ordinalmenge
            "hitn": {t: {} for t in NIGHT_THRS},                   # Nacht-Treffer: Schwelle -> Jahr -> Ordinalmenge
            "prevo": None,
            # Serien: Tage (Tagesmax>=Schwelle), Nächte ("n25" etc., Tagesmin>=Schwelle), Eis
            "streak": dict([(t, new_streak()) for t in HEAT_THRS]
                           + [("n%d" % t, new_streak()) for t in NIGHT_THRS]
                           + [("ice", new_streak())])}
acc = {}
nat = {t: {} for t in HEAT_THRS}        # Schwelle -> Jahr -> Tagesmenge (national, Tagesmax >= Schwelle)
nat_night = {t: {} for t in NIGHT_THRS} # Schwelle -> Jahr -> Nachtmenge (national, Tagesmin >= Schwelle)
# nationale Jahres-Extreme (für die Zeitreihe): Jahr -> (Wert, Station, Datum)
yr_maxt, yr_mint, yr_night = {}, {}, {}

lo_i, hi_i = frm * 10000 + 101, to * 10000 + 1231
for internal in internals:
    wmo = internal2wmo.get(internal)
    if not wmo:
        continue
    zp = os.path.join(cache, internal + ".zip")
    if not os.path.exists(zp):
        continue
    try:
        zf = zipfile.ZipFile(zp)
    except (zipfile.BadZipFile, OSError):
        continue
    member = next((m for m in zf.namelist()
                   if os.path.basename(m).startswith("produkt_klima_tag")), None)
    if not member:
        continue
    a = acc.get(wmo)
    if a is None:
        a = acc[wmo] = new_acc()
    for ln in zf.read(member).decode("latin-1", "replace").splitlines()[1:]:
        fields = ln.split(";")
        if len(fields) < 17:
            continue
        try:
            dt = int(fields[1])
        except ValueError:
            continue
        txk, tnk = num(fields[15]), num(fields[16])
        if txk is None and tnk is None:
            continue
        y, m, d = dt // 10000, (dt // 100) % 100, dt % 100
        ds = "%04d-%02d-%02d" % (y, m, d)
        try:
            o = datetime.date(y, m, d).toordinal()
        except ValueError:
            o = None
        # ---- Allzeit-Rekorde je Station (ganze Historie, ungefiltert) -> records.json ----
        if txk is not None and (a["rmx"] is None or txk > a["rmx"]):
            a["rmx"] = txk; a["rmxd"] = ds
        if tnk is not None and (a["rmn"] is None or tnk < a["rmn"]):
            a["rmn"] = tnk; a["rmnd"] = ds
        if tnk is not None and (a["rnight"] is None or tnk > a["rnight"]):
            a["rnight"] = tnk; a["rnightd"] = ds
        # erstes/letztes Jahr mit Daten (für Panel-Zugehörigkeit)
        if a["fy"] is None or y < a["fy"]: a["fy"] = y
        if a["ly"] is None or y > a["ly"]: a["ly"] = y
        # nationale Jahres-Extreme (Zeitreihe)
        if txk is not None and (y not in yr_maxt or txk > yr_maxt[y][0]): yr_maxt[y] = (txk, wmo, ds)
        if tnk is not None and (y not in yr_mint or tnk < yr_mint[y][0]): yr_mint[y] = (tnk, wmo, ds)
        if tnk is not None and (y not in yr_night or tnk > yr_night[y][0]): yr_night[y] = (tnk, wmo, ds)
        if txk is not None:                                       # Tage >= Schwelle (30/35/40/45) + national + Panel-Treffer
            for t in HEAT_THRS:
                if txk >= t:
                    a["days"][t][y] = a["days"][t].get(y, 0) + 1
                    if o is not None:
                        nat[t].setdefault(y, set()).add(o)
                        a["hit"][t].setdefault(y, set()).add(o)
        if tnk is not None:                                       # warme Nächte >= Schwelle (20/25/30)
            for t in NIGHT_THRS:
                if tnk >= t:
                    a["nights"][t][y] = a["nights"][t].get(y, 0) + 1
                    if o is not None:
                        nat_night[t].setdefault(y, set()).add(o)
                        a["hitn"][t].setdefault(y, set()).add(o)
        if o is not None:                                         # Serien (aufeinanderfolgende Tage)
            cons = a["prevo"] is not None and o == a["prevo"] + 1
            for t in HEAT_THRS:
                upd_streak(a["streak"][t], txk is not None and txk >= t, o, cons)
            for t in NIGHT_THRS:
                upd_streak(a["streak"]["n%d" % t], tnk is not None and tnk >= t, o, cons)
            upd_streak(a["streak"]["ice"], txk is not None and txk < 0, o, cons)   # Eistag: TXK < 0
            a["prevo"] = o
        # ab hier nur die Normalperiode (für reference.json)
        if dt < lo_i or dt > hi_i:
            continue
        try:
            doy = (datetime.date(y, m, d) - datetime.date(y, 1, 1)).days + 1
        except ValueError:
            continue
        a["n"] += 1
        a["years"].add(y)
        if txk is not None:
            a["smax"][doy] += txk; a["cmax"][doy] += 1
            k = str(rnd(txk)); a["hmax"][k] = a["hmax"].get(k, 0) + 1
        if tnk is not None:
            a["smin"][doy] += tnk; a["cmin"][doy] += 1
            k = str(rnd(tnk)); a["hmin"][k] = a["hmin"].get(k, 0) + 1

def smooth(sums, counts):
    """Zentriertes, mengen-gewichtetes Fenster ±window (zirkulär über 1..366)."""
    out = [None] * N
    span = list(range(1, 367))
    for d in span:
        s = c = 0
        for k in range(d - window, d + window + 1):
            idx = ((k - 1) % 366) + 1     # zirkulär 1..366
            s += sums[idx]; c += counts[idx]
        out[d] = round(s / c, 1) if c >= min_samples else None
    return out

stations = {}
kept = dropped = 0
for wmo, a in acc.items():
    # Normal-Linie nur für POI-Stationen (die ein Detail-Modal haben) + ausreichend lange Reihe
    if wmo not in poi_keys or a["n"] < min_station or len(a["years"]) < min_years:
        dropped += 1; continue
    ys = a["years"]
    stations[wmo] = {
        "max": smooth(a["smax"], a["cmax"]),
        "min": smooth(a["smin"], a["cmin"]),
        "histMax": a["hmax"],
        "histMin": a["hmin"],
        "y0": min(ys), "y1": max(ys), "ny": len(ys),   # tatsächlich genutzte Jahresspanne
    }
    kept += 1

doc = {"period": "%d-%d" % (frm, to), "stations": stations}
if not recent:   # --recent kennt die Normalperiode nicht -> reference.json unangetastet lassen
    with io.open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

# Allzeit-Rekorde je Station (unabhängig vom Normalperioden-Gate) -> records.json
def od(o):
    return datetime.date.fromordinal(o).isoformat() if o else None
records = {}
for wmo, a in acc.items():
    rec = {}
    if a["rmx"] is not None:
        rec["maxC"] = a["rmx"]; rec["maxDate"] = a["rmxd"]
    if a["rmn"] is not None:
        rec["minC"] = a["rmn"]; rec["minDate"] = a["rmnd"]
    if a["rnight"] is not None:
        rec["nightC"] = a["rnight"]; rec["nightDate"] = a["rnightd"]
    # Serien: Tage (Tagesmax), Nächte (Tagesmin), Eis
    for skey, key in ((30, "heat"), (35, "desert"), (40, "extreme"), (45, "glut"),
                      ("n20", "trop"), ("n25", "wnight"), ("n30", "strop"), ("ice", "ice")):
        s = a["streak"][skey]
        if s["best"] >= 2:
            rec[key + "Len"] = s["best"]; rec[key + "Start"] = od(s["beg"]); rec[key + "End"] = od(s["end"])
    for t, key in ((30, "hot"), (35, "desert"), (40, "extreme"), (45, "glut")):  # meiste Tage/Jahr je Schwelle
        dd = a["days"][t]
        if dd:
            yy, cc = max(dd.items(), key=lambda kv: kv[1]); rec[key + "Days"] = cc; rec[key + "Year"] = yy
    for t, key in ((20, "trop"), (25, "wnight"), (30, "strop")):     # meiste warme Nächte/Jahr je Schwelle
        dd = a["nights"][t]
        if dd:
            yy, cc = max(dd.items(), key=lambda kv: kv[1]); rec[key + "N"] = cc; rec[key + "Year"] = yy
    if rec:
        records[wmo] = rec

national = {}
for key, t in (("hotDaysBest", 30), ("desertDaysBest", 35), ("extremeDaysBest", 40), ("glutDaysBest", 45)):
    ns = nat[t]
    if ns:
        yy, dd = max(ns.items(), key=lambda kv: len(kv[1])); national[key] = {"count": len(dd), "year": yy}
for key, t in (("tropBest", 20), ("wnightBest", 25), ("stropBest", 30)):
    ns = nat_night[t]
    if ns:
        yy, dd = max(ns.items(), key=lambda kv: len(kv[1])); national[key] = {"count": len(dd), "year": yy}

# Namen der reinen Klimastationen (POI-Namen kommen im Frontend aus coords)
rec_names = {k: names[k] for k in names if k in records}

# Extremwert-Suffixe für den Merge (Wert-Key -> Datums-/Jahr-Begleiter, Richtung)
EXT_FIELDS = (("maxC", "maxDate", "max"), ("minC", "minDate", "min"), ("nightC", "nightDate", "max"))
STREAK_BASES = ("heat", "desert", "extreme", "glut", "trop", "wnight", "strop", "ice")
DAYS_BASES = ("hot", "desert", "extreme", "glut")
NIGHT_BASES = ("trop", "wnight", "strop")

def merge_record(old, new):
    """Übernimmt aus new nur echte Verbesserungen (neue Rekorde) in old."""
    for vkey, dkey, direction in EXT_FIELDS:
        if vkey in new:
            better = vkey not in old or (new[vkey] > old[vkey] if direction == "max" else new[vkey] < old[vkey])
            if better:
                old[vkey] = new[vkey]; old[dkey] = new[dkey]
    for base in STREAK_BASES:                              # längste Serie
        L = base + "Len"
        if L in new and (L not in old or new[L] > old[L]):
            old[L] = new[L]; old[base + "Start"] = new[base + "Start"]; old[base + "End"] = new[base + "End"]
    for base in DAYS_BASES:                                # meiste Tage/Jahr
        D = base + "Days"
        if D in new and (D not in old or new[D] > old[D]):
            old[D] = new[D]; old[base + "Year"] = new[base + "Year"]
    for base in NIGHT_BASES:                               # meiste warme Nächte/Jahr
        Ncnt = base + "N"
        if Ncnt in new and (Ncnt not in old or new[Ncnt] > old[Ncnt]):
            old[Ncnt] = new[Ncnt]; old[base + "Year"] = new[base + "Year"]

if recent:
    try:
        with io.open(out_records, encoding="utf-8") as f:
            base = json.load(f)
    except (OSError, ValueError):
        base = {"records": {}, "national": {}, "names": {}}
    R = base.setdefault("records", {})
    for k, nr in records.items():
        merge_record(R.setdefault(k, {}), nr)
    NAT = base.setdefault("national", {})
    for k, nv in national.items():
        if k not in NAT or nv["count"] > NAT[k]["count"]:
            NAT[k] = nv
    NM = base.setdefault("names", {})
    for k, v in rec_names.items():
        NM.setdefault(k, v)
    NM_out = {k: NM[k] for k in NM if k in R}              # nur Namen zu tatsächlichen Rekord-Stationen
    out_obj = {"records": R, "national": NAT, "names": NM_out}
else:
    out_obj = {"records": records, "national": national, "names": rec_names}

with io.open(out_records, "w", encoding="utf-8") as f:
    json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

# ---- Zeitreihe je Metrik (national), für das Rekord-Modal -> timeline.json ----
end_y = max((a["ly"] for a in acc.values() if a["ly"]), default=to)
tyears = list(range(tl_start, end_y + 1))

def r1(v):
    return round(v, 1) if v is not None else None

# Extremwerte: ein Wert je Jahr (+ Station/Datum für den Hover)
def ext_series(src):
    val, st, dt = [], [], []
    for y in tyears:
        e = src.get(y)
        val.append(r1(e[0]) if e else None)
        st.append(e[1] if e else None); dt.append(e[2] if e else None)
    return {"val": val, "st": st, "dt": dt}

metrics = {}
metrics["maxTemp"] = {"kind": "ext", "dir": "max", **ext_series(yr_maxt)}
metrics["minTemp"] = {"kind": "ext", "dir": "min", **ext_series(yr_mint)}
metrics["warmNight"] = {"kind": "ext", "dir": "max", **ext_series(yr_night)}
for thr, key in ((30, "hotDays"), (35, "desertDays"), (40, "extremeDays"), (45, "glutDays")):
    metrics[key] = {"kind": "count", "all": [len(nat[thr].get(y, ())) for y in tyears]}
for thr, key in ((20, "tropN"), (25, "wnightN"), (30, "stropN")):
    metrics[key] = {"kind": "count", "all": [len(nat_night[thr].get(y, ())) for y in tyears]}

# „Meiste" (Höchstwert je Station/Jahr) und „Serie" (längste Serie/Jahr), national = Maximum über Stationen
def longest_run(ordset):
    if not ordset:
        return 0
    xs = sorted(ordset); best = run = 1
    for i in range(1, len(xs)):
        run = run + 1 if xs[i] == xs[i - 1] + 1 else 1
        if run > best: best = run
    return best

def max_over_stations(dayattr, thr, kind):
    out = {}   # Jahr -> (Wert, Station-WMO)
    for wmo, a in acc.items():
        src = a[dayattr][thr]
        for y, x in src.items():
            v = x if kind == "count" else longest_run(x)
            if y not in out or v > out[y][0]:
                out[y] = (v, wmo)
    return out

def series_metric(o):
    return {"kind": "count",
            "all": [o.get(y, (0, None))[0] for y in tyears],
            "st": [o.get(y, (0, None))[1] for y in tyears]}   # Station je Jahr (für Hover)

for thr, base in ((30, "hot"), (35, "desert"), (40, "extreme"), (45, "glut")):
    metrics[base + "DaysMax"] = series_metric(max_over_stations("days", thr, "count"))
    metrics[base + "Streak"] = series_metric(max_over_stations("hit", thr, "run"))
for thr, base in ((20, "trop"), (25, "wnight"), (30, "strop")):
    metrics[base + "NMax"] = series_metric(max_over_stations("nights", thr, "count"))
    metrics[base + "Streak"] = series_metric(max_over_stations("hitn", thr, "run"))

def tl_names(mtr, name_src):
    """Namen der (reinen Klima-)Stationen, die als „st" in einer Zeitreihe vorkommen."""
    keys = set()
    for mm in mtr.values():
        for k in mm.get("st", []) or []:
            if k in name_src:
                keys.add(k)
    return {k: name_src[k] for k in keys}

if recent:
    # Frische Recent-Werte in die committete Timeline mergen: pro Metrik & Jahr den
    # „besseren" Wert behalten (Extreme richtungsabhängig, Zähler/Serien = Maximum).
    try:
        with io.open(out_timeline, encoding="utf-8") as f:
            base = json.load(f)
    except (OSError, ValueError):
        base = {"years": [], "metrics": {}, "names": {}}
    oy = base.get("years", [])
    om = base.get("metrics", {})
    all_years = sorted(set(oy) | set(tyears))

    def lut(m, years):
        """Jahr -> (Wert, Station, Datum), Nones übersprungen (= kein Messwert)."""
        r = {}
        if not m:
            return r
        arr = m.get("val") if m.get("kind") == "ext" else m.get("all")
        arr = arr or []
        sts = m.get("st"); dts = m.get("dt")
        for i, y in enumerate(years):
            if i < len(arr) and arr[i] is not None:
                r[y] = (arr[i], sts[i] if sts else None, dts[i] if dts else None)
        return r

    merged = {}
    for k in set(om) | set(metrics):
        o, nw = om.get(k), metrics.get(k)
        proto = o if o is not None else nw
        kind = proto.get("kind"); direction = proto.get("dir", "max")
        has_st = "st" in proto; has_dt = "dt" in proto
        lo, ln = lut(o, oy), lut(nw, tyears)
        val, st, dt = [], [], []
        for y in all_years:
            a, b = lo.get(y), ln.get(y)
            if a and b:
                pick = a if (a[0] <= b[0] if direction == "min" else a[0] >= b[0]) else b
            else:
                pick = a or b
            val.append(pick[0] if pick else None)
            st.append(pick[1] if pick else None)
            dt.append(pick[2] if pick else None)
        mm = {"kind": kind}
        if kind == "ext":
            mm["dir"] = direction; mm["val"] = val
        else:
            mm["all"] = val
        if has_st: mm["st"] = st
        if has_dt: mm["dt"] = dt
        merged[k] = mm

    name_src = dict(base.get("names", {})); name_src.update(names)
    tl = {"years": all_years, "metrics": merged, "names": tl_names(merged, name_src)}
else:
    tl = {"years": tyears, "metrics": metrics, "names": tl_names(metrics, names)}

with io.open(out_timeline, "w", encoding="utf-8") as f:
    json.dump(tl, f, ensure_ascii=False, separators=(",", ":"))

if recent:
    print("   recent-Merge: %d Stationen mit Werten -> records.json/timeline.json aktualisiert"
          % len(acc), file=sys.stderr)
    print("   records.json: %d Stationen · timeline.json: %d Jahre"
          % (len(out_obj["records"]), len(tl["years"])), file=sys.stderr)
else:
    print("   Stationen mit Referenz: %d  (zu wenig Daten verworfen: %d)" % (kept, dropped),
          file=sys.stderr)
    print("   geschrieben: %s" % out_path, file=sys.stderr)
    print("   records.json: %d Stationen (Allzeit-Rekorde)" % len(records), file=sys.stderr)
    print("   timeline.json: %d Jahre" % len(tyears), file=sys.stderr)
PY

# ---------------------------------------------------------------------------
# 6) Optional: volle Tageshistorie je Station -> history/<wmo>.json
#    (alle Jahre, aus demselben Cache; vom Frontend on-demand geladen)
# ---------------------------------------------------------------------------
if [ "$HISTORY" -eq 1 ]; then
  echo "» Schreibe volle Tageshistorie je Station (history/<wmo>.json) …"
  HIST_DIR="$DATA/history"
  mkdir -p "$HIST_DIR"
  python3 - "$XWALK" "$DLLIST" "$CACHE" "$HIST_DIR" <<'PY'
import sys, os, io, json, zipfile, datetime

xwalk, dllist, cache, out_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

internal2wmo = {}   # nur POI (poi==1) -> history/ nur für Stationen mit Detail-Modal
with io.open(xwalk, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) >= 4 and p[3] == "1":
            internal2wmo[p[1]] = p[0]

internals = []
with io.open(dllist, encoding="utf-8") as f:
    for ln in f:
        p = ln.split()
        if p:
            internals.append(p[0])

def num(x):
    x = x.strip()
    try:
        v = float(x)
    except ValueError:
        return None
    return None if v <= -999 else v

EPOCH = datetime.date(1, 1, 1)
written = total_days = 0
for internal in internals:
    wmo = internal2wmo.get(internal)
    if not wmo:
        continue
    zp = os.path.join(cache, internal + ".zip")
    if not os.path.exists(zp):
        continue
    try:
        zf = zipfile.ZipFile(zp)
    except (zipfile.BadZipFile, OSError):
        continue
    member = next((m for m in zf.namelist()
                   if os.path.basename(m).startswith("produkt_klima_tag")), None)
    if not member:
        continue
    rec = {}  # ordinal -> (txk, tnk)
    for ln in zf.read(member).decode("latin-1", "replace").splitlines()[1:]:
        fields = ln.split(";")
        if len(fields) < 17:
            continue
        try:
            dt = int(fields[1])
        except ValueError:
            continue
        txk, tnk = num(fields[15]), num(fields[16])
        if txk is None and tnk is None:
            continue
        y, m, d = dt // 10000, (dt // 100) % 100, dt % 100
        try:
            o = datetime.date(y, m, d).toordinal()
        except ValueError:
            continue
        rec[o] = (txk, tnk)
    if not rec:
        continue
    lo_o, hi_o = min(rec), max(rec)
    n = hi_o - lo_o + 1
    mx = [None] * n
    mn = [None] * n
    for o, (txk, tnk) in rec.items():
        i = o - lo_o
        mx[i] = txk; mn[i] = tnk
    start = datetime.date.fromordinal(lo_o).isoformat()
    # dichte Tagesreihe ab start (Index = Tagesoffset); Frontend rekonstruiert Datum
    doc = {"start": start, "max": mx, "min": mn}
    with io.open(os.path.join(out_dir, wmo + ".json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    written += 1; total_days += len(rec)

print("   history-Dateien: %d  (Σ %d Tageswerte)" % (written, total_days), file=sys.stderr)
print("   geschrieben unter: %s" % out_dir, file=sys.stderr)
PY
fi

if [ "$RECENT" -eq 1 ]; then
  echo "Fertig — records.json + timeline.json mit recent-Werten aktualisiert."
else
  echo "Fertig — reference.json$([ "$HISTORY" -eq 1 ] && echo ' + history/') erzeugt."
fi
