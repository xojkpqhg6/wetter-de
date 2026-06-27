#!/usr/bin/env bash
#
# temp-leaderboard.sh — Temperatur-Leaderboard für Deutschland
#
# Quelle: Deutscher Wetterdienst (DWD), OpenData
#   - Aktuelle Messwerte je Station: weather_reports/poi/<ID>-BEOB.csv (stündlich)
#   - Stationsnamen:                 MOSMIX-Stationskatalog
#
# Lädt die Rohdaten und gibt das Leaderboard im Terminal aus.
# Alle Daten liegen unter web/public/data/ (direkt von der Website erreichbar).
# Persistiert bei jedem Lauf:
#   - latest.json               : aktueller Snapshot (Rangliste jetzt)
#   - tops.json                 : Höchstwerte je Station für Tag/Woche/Monat/Jahr
#   - history.csv               : Roh-Log (nur neue Messungen), Zeit in UTC
#   - daily/<UTC-Datum>.json     : Tages-Min/Max je Station, Zeit in UTC
# Anzeige im Terminal in Berlin-Zeit, gespeichert wird immer UTC.
# Bewusst portabel gehalten (läuft auf macOS-bash 3.2, keine assoz. Arrays).

set -u

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------
ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="$ROOT/web/public/data"   # alle Daten direkt im Web-Verzeichnis
POI_DIR="$DATA/poi"

POI_BASE="https://opendata.dwd.de/weather/weather_reports/poi"
CAT_URL="https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_stationskatalog.cfg?view=nasPublication&nn=16102"

TOP=15            # wie viele Stationen oben anzeigen (0 = alle)
SHOW_COLD=0       # zusätzlich die kältesten zeigen
REFRESH=0         # Caches/Downloads erzwingen
JOBS=8            # parallele Downloads
MAX_AGE_MIN=50    # POI-Datei gilt jünger als X Minuten als "frisch"

# ---------------------------------------------------------------------------
# Argumente
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Temperatur-Leaderboard Deutschland (Daten: DWD OpenData)

Verwendung: $(basename "$0") [Optionen]

  --top N        Top N heißeste Stationen anzeigen (Standard: $TOP, 0 = alle)
  --all          alle Stationen anzeigen (= --top 0)
  --cold         zusätzlich die 10 kältesten Stationen anzeigen
  --refresh      Stationskatalog & alle Messwerte neu laden (Cache ignorieren)
  --jobs N       parallele Downloads (Standard: $JOBS)
  -h, --help     diese Hilfe

Daten landen unter web/public/data/ (latest.json, tops.json, history.csv, daily/).

Beispiele:
  $(basename "$0")                 # Top 15 heißeste Orte gerade jetzt
  $(basename "$0") --top 30 --cold # Top 30 + die 10 kältesten
  $(basename "$0") --refresh       # frische Daten ziehen
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --top)     TOP="${2:-15}"; shift 2 ;;
    --all)     TOP=0; shift ;;
    --cold)    SHOW_COLD=1; shift ;;
    --refresh) REFRESH=1; shift ;;
    --jobs)    JOBS="${2:-8}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

mkdir -p "$POI_DIR"

# ---------------------------------------------------------------------------
# Farben (nur wenn Terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
  CYAN=$'\033[36m'; YEL=$'\033[33m'; RED=$'\033[31m'; BLU=$'\033[34m'
else
  B=""; DIM=""; R=""; CYAN=""; YEL=""; RED=""; BLU=""
fi

log() { printf '%s\n' "$*" >&2; }

# UTC-Messzeit (DD.MM.YY HH:MM) -> Berlin-Zeit "DD.MM HH:MM" (mit DST).
# Speichern bleibt UTC, nur die Anzeige wird umgerechnet.
to_berlin() {  # $1=DD.MM.YY  $2=HH:MM
  local epoch d mo y
  # BSD date (macOS)
  if epoch="$(date -j -u -f "%d.%m.%y %H:%M" "$1 $2" +%s 2>/dev/null)"; then
    TZ="Europe/Berlin" date -r "$epoch" "+%d.%m %H:%M" 2>/dev/null && return
  fi
  # GNU date (Linux/CI): DD.MM.YY -> YYYY-MM-DD
  d="${1%%.*}"; mo="${1#*.}"; mo="${mo%.*}"; y="20${1##*.}"
  if epoch="$(date -u -d "${y}-${mo}-${d} $2:00 UTC" +%s 2>/dev/null)"; then
    TZ="Europe/Berlin" date -d "@$epoch" "+%d.%m %H:%M" 2>/dev/null && return
  fi
  printf '%s %s' "$1" "$2"
}
TZ_ABBR="$(TZ="Europe/Berlin" date +%Z 2>/dev/null || echo Berlin)"

# ---------------------------------------------------------------------------
# 1) Stationskatalog (Name je ID) – wird selten aktualisiert -> 7 Tage Cache
# ---------------------------------------------------------------------------
CAT_FILE="$DATA/stations.cfg"
if [ "$REFRESH" -eq 1 ] || [ ! -s "$CAT_FILE" ] || [ -z "$(find "$CAT_FILE" -mtime -7 2>/dev/null)" ]; then
  log "${DIM}» Lade Stationskatalog …${R}"
  curl -fsS --max-time 60 "$CAT_URL" -o "$CAT_FILE.tmp" \
    && mv "$CAT_FILE.tmp" "$CAT_FILE" \
    || { log "${RED}Fehler: Stationskatalog konnte nicht geladen werden${R}"; rm -f "$CAT_FILE.tmp"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 2) Deutsche Stationen (WMO-Block 10xxx) bestimmen, die es auch als POI gibt
#    Ergebnis: data/de_stations.tsv  ->  ID <tab> NAME
# ---------------------------------------------------------------------------
DE_FILE="$DATA/de_stations.tsv"
if [ "$REFRESH" -eq 1 ] || [ ! -s "$DE_FILE" ]; then
  log "${DIM}» Ermittle deutsche Messstationen …${R}"
  # alle 10xxx aus dem Katalog (fixe Spalten: ID 1-5, NAME 12-31)
  awk 'NR>2 {
         id=substr($0,1,5)
         if (id ~ /^10[0-9][0-9][0-9]$/) {
           name=substr($0,12,20); gsub(/[ \t]+$/,"",name)
           print id"\t"name
         }
       }' "$CAT_FILE" > "$DATA/_de_all.tsv"

  # Liste der tatsächlich vorhandenen POI-Dateien
  curl -fsS --max-time 60 "$POI_BASE/" \
    | grep -oE '[0-9A-Z]+-BEOB\.csv' | sed 's/-BEOB\.csv//' | sort -u > "$DATA/_poi_ids.txt"

  # Schnittmenge
  awk -F'\t' 'NR==FNR{p[$1]=1; next} ($1 in p)' "$DATA/_poi_ids.txt" "$DATA/_de_all.tsv" > "$DE_FILE"
  rm -f "$DATA/_de_all.tsv" "$DATA/_poi_ids.txt"
fi

STATION_COUNT="$(wc -l < "$DE_FILE" | tr -d ' ')"
if [ "$STATION_COUNT" -eq 0 ]; then
  log "${RED}Keine Stationen gefunden – Abbruch.${R}"; exit 1
fi

# ---------------------------------------------------------------------------
# 3) Messwerte je Station laden (parallel, mit Frische-Cache)
# ---------------------------------------------------------------------------
NEED="$DATA/_need.txt"; : > "$NEED"
while IFS=$'\t' read -r id name; do
  f="$POI_DIR/$id-BEOB.csv"
  if [ "$REFRESH" -eq 1 ] || [ ! -s "$f" ] || [ -z "$(find "$f" -mmin -$MAX_AGE_MIN 2>/dev/null)" ]; then
    echo "$id" >> "$NEED"
  fi
done < "$DE_FILE"

NEED_COUNT="$(wc -l < "$NEED" | tr -d ' ')"
if [ "$NEED_COUNT" -gt 0 ]; then
  log "${DIM}» Lade Messwerte: $NEED_COUNT/$STATION_COUNT Stationen (parallel x$JOBS) …${R}"
  cat "$NEED" | xargs -P "$JOBS" -I{} sh -c '
    f="'"$POI_DIR"'/{}-BEOB.csv"
    curl -fsS --max-time 30 "'"$POI_BASE"'/{}-BEOB.csv" -o "$f.tmp" \
      && mv "$f.tmp" "$f" || rm -f "$f.tmp"
  '
else
  log "${DIM}» Alle Messwerte aktuell (Cache).${R}"
fi
rm -f "$NEED"

# ---------------------------------------------------------------------------
# 4) ALLE gültigen Stundenwerte je Station extrahieren
#    POI-CSV: ';'-getrennt, 3 Kopfzeilen, Dezimalkomma. Eine Datei enthält die
#    letzten ~24 h stündlich -> wir lesen alle Zeilen, nicht nur die neueste.
#    So gehen bei verspätetem/seltenem Cron keine Stunden verloren (Dedup per
#    obs_utc in 4b), und das Tages-Min/Max wird aus allen Stundenwerten exakt.
#    Feld 1=Datum, 2=Uhrzeit(UTC), 10=Temperatur(2m). '---' = kein Wert.
#    Ergebnis je Zeile: temp <tab> id <tab> name <tab> datum <tab> zeit
# ---------------------------------------------------------------------------
RES="$DATA/_results.tsv"; : > "$RES"
while IFS=$'\t' read -r id name; do
  f="$POI_DIR/$id-BEOB.csv"
  [ -s "$f" ] || continue
  awk -F';' -v id="$id" -v name="$name" '
    NR>3 {
      t=$10; gsub(/\r/,"",t); gsub(/^[ \t]+|[ \t]+$/,"",t)
      if (t!="" && t!="---") {
        gsub(/,/,".",t)
        d=$1; gsub(/\r/,"",d)
        u=$2; gsub(/\r/,"",u)
        print t"\t"id"\t"name"\t"d"\t"u
      }
    }' "$f" >> "$RES"
done < "$DE_FILE"

VALID="$(wc -l < "$RES" | tr -d ' ')"
if [ "$VALID" -eq 0 ]; then
  log "${RED}Keine gültigen Messwerte – evtl. DWD gerade nicht erreichbar.${R}"; exit 1
fi

# ---------------------------------------------------------------------------
# 4b) Persistenz: Roh-Historie (CSV) + Tages-Min/Max je Station (JSON)
#     Speicherung immer in UTC. Bucket = UTC-Datum der Messung.
# ---------------------------------------------------------------------------
log "${DIM}» Schreibe Historie & Tages-JSON …${R}"
python3 - "$DATA" "$RES" <<'PY'
import sys, os, io, csv, json, glob, math
from datetime import datetime, timezone

data_dir, res_path = sys.argv[1], sys.argv[2]
now_dt = datetime.now(timezone.utc)
run_utc = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

# --- aktuelle Messwerte einlesen (temp, id, name, datum, zeit; Zeit = UTC) ---
rows = []
with io.open(res_path, encoding="utf-8") as f:
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) < 5:
            continue
        temp, sid, name, d, u = p[:5]
        try:
            t = float(temp)
        except ValueError:
            continue
        try:
            obs = datetime.strptime(d + " " + u, "%d.%m.%y %H:%M").replace(tzinfo=timezone.utc)
            obs_iso = obs.strftime("%Y-%m-%dT%H:%M:%SZ")
            obs_date = obs.strftime("%Y-%m-%d")
        except ValueError:
            obs_iso, obs_date = "", ""
        rows.append((t, sid, name, obs_iso, obs_date))

names = {sid: name for _, sid, name, _, _ in rows}

# --- latest.json: neueste gültige Messung je Station (rows enthält jetzt alle Stunden) ---
latest_by = {}
for t, sid, name, obs_iso, _ in rows:
    cur = latest_by.get(sid)
    if cur is None or obs_iso > cur["obs_utc"]:
        latest_by[sid] = {"id": sid, "name": name, "temp_c": t, "obs_utc": obs_iso}
snap = sorted(latest_by.values(), key=lambda x: x["temp_c"], reverse=True)
json.dump({"generated_utc": run_utc, "station_count": len(snap), "stations": snap},
          io.open(os.path.join(data_dir, "latest.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

# --- history.csv + daily/ (Dedup per (Station, obs_utc)) ---
# Set statt "neuer als Max" -> auch nachträglich verpasste Stunden (Lücken)
# werden aus der ~24h-POI-Datei gefüllt, nicht nur die jeweils neueste.
hist = os.path.join(data_dir, "history.csv")
daily_dir = os.path.join(data_dir, "daily")
os.makedirs(daily_dir, exist_ok=True)
seen = set()
if os.path.exists(hist):
    with io.open(hist, encoding="utf-8", newline="") as f:
        r = csv.reader(f); next(r, None)
        for rec in r:
            if len(rec) >= 4 and rec[3]:
                seen.add((rec[1], rec[3]))
fresh = [row for row in rows if row[3] and (row[1], row[3]) not in seen]
if fresh:
    new = not os.path.exists(hist)
    with io.open(hist, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["run_utc", "station_id", "name", "obs_utc", "temp_c"])
        for t, sid, name, obs_iso, _ in fresh:
            w.writerow([run_utc, sid, name, obs_iso, t])
    buckets = {}
    for t, sid, name, obs_iso, obs_date in fresh:
        buckets.setdefault(obs_date, []).append((t, sid, name, obs_iso))
    for date, items in buckets.items():
        path = os.path.join(daily_dir, date + ".json")
        doc = {"date": date, "stations": {}}
        if os.path.exists(path):
            try:
                doc = json.load(io.open(path, encoding="utf-8")); doc.setdefault("stations", {})
            except (ValueError, OSError):
                doc = {"date": date, "stations": {}}
        st = doc["stations"]
        for t, sid, name, obs_iso in items:
            e = st.get(sid)
            if e is None:
                st[sid] = {"name": name, "min_c": t, "min_obs_utc": obs_iso,
                           "max_c": t, "max_obs_utc": obs_iso, "samples": 1}
            else:
                e["name"] = name; e["samples"] = e.get("samples", 0) + 1
                if t > e["max_c"]:
                    e["max_c"], e["max_obs_utc"] = t, obs_iso
                if t < e["min_c"]:
                    e["min_c"], e["min_obs_utc"] = t, obs_iso
        doc["date"] = date; doc["updated_utc"] = run_utc
        json.dump(doc, io.open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2, sort_keys=True)

# --- alle Daily-Files EINMAL einlesen (fuer tops, series, stats) ---
daily_data = []      # [(date, stations_dict)]
all_names = {}
for f in sorted(glob.glob(os.path.join(daily_dir, "*.json"))):
    base = os.path.basename(f)[:-5]
    try:
        doc = json.load(io.open(f, encoding="utf-8"))
    except (ValueError, OSError):
        continue
    st = doc.get("stations", {})
    for sid, e in st.items():
        all_names[sid] = e.get("name", sid)
    daily_data.append((base, st))
date_list = [b for b, _ in daily_data]
all_names.update(names)

# Tagesminimum nur vertrauen, wenn der Tag echt abgedeckt ist: backfilled (echtes
# TNK) ODER nahezu voll (samples>=20). Teiltage (z. B. nur Nachmittag) liefern
# sonst ein viel zu hohes "Min" (= Tageswert). Max bleibt unkritisch.
def trust_min(e):
    if e.get("source") == "dwd-kl" or e.get("samples", 0) >= 20:
        return e.get("min_c")
    return None

# --- tops.json: Hoechst- UND Tiefstwert je Zeitraum ---
today = now_dt.date()
ty, tw, _ = today.isocalendar()
pkey = {"day": today.strftime("%Y-%m-%d"), "week": "%04d-W%02d" % (ty, tw),
        "month": today.strftime("%Y-%m"), "year": today.strftime("%Y")}

def in_periods(dd):
    out = []
    if dd == today:
        out.append("day")
    iy, iw, _ = dd.isocalendar()
    if (iy, iw) == (ty, tw):
        out.append("week")
    if dd.year == today.year and dd.month == today.month:
        out.append("month")
    if dd.year == today.year:
        out.append("year")
    return out

agg = {p: {} for p in ("day", "week", "month", "year")}
for base, st in daily_data:
    try:
        dd = datetime.strptime(base, "%Y-%m-%d").date()
    except ValueError:
        continue
    mem = in_periods(dd)
    if not mem:
        continue
    for sid, e in st.items():
        mx, mn = e.get("max_c"), trust_min(e)
        for p in mem:
            cur = agg[p].get(sid)
            if cur is None:
                agg[p][sid] = {"name": e.get("name", sid),
                               "max_c": mx, "max_obs_utc": e.get("max_obs_utc", ""),
                               "min_c": mn, "min_obs_utc": e.get("min_obs_utc", "")}
            else:
                cur["name"] = e.get("name", sid)
                if mx is not None and (cur["max_c"] is None or mx > cur["max_c"]):
                    cur["max_c"], cur["max_obs_utc"] = mx, e.get("max_obs_utc", "")
                if mn is not None and (cur["min_c"] is None or mn < cur["min_c"]):
                    cur["min_c"], cur["min_obs_utc"] = mn, e.get("min_obs_utc", "")
tops = {"generated_utc": run_utc, "periods": {}}
for p in ("day", "week", "month", "year"):
    sts = [{"id": sid, "name": v["name"], "max_c": v["max_c"], "max_obs_utc": v["max_obs_utc"],
            "min_c": v["min_c"], "min_obs_utc": v["min_obs_utc"]}
           for sid, v in agg[p].items() if v["max_c"] is not None]
    sts.sort(key=lambda x: x["max_c"], reverse=True)
    tops["periods"][p] = {"key": pkey[p], "station_count": len(sts), "stations": sts}
json.dump(tops, io.open(os.path.join(data_dir, "tops.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

# --- series.json: gemeinsame Datumsliste + Max/Min-Reihen je Station ---
n = len(date_list)
series = {}
for idx, (base, st) in enumerate(daily_data):
    for sid, e in st.items():
        s = series.get(sid)
        if s is None:
            s = {"max": [None] * n, "min": [None] * n}; series[sid] = s
        s["max"][idx] = e.get("max_c"); s["min"][idx] = trust_min(e)
json.dump({"dates": date_list, "stations": series},
          io.open(os.path.join(data_dir, "series.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

# --- stations.json: Koordinaten (Grad-Minuten -> Dezimalgrad) ---
def ddmm(x):
    dd = math.floor(x); return dd + (x - dd) * 100.0 / 60.0
coords = {}
cfg = os.path.join(data_dir, "stations.cfg")
if os.path.exists(cfg):
    with io.open(cfg, encoding="latin-1") as f:
        for ln in f:
            tk = ln.split()
            if len(tk) >= 5 and len(tk[0]) == 5 and tk[0].isdigit() and tk[0][:2] == "10":
                try:
                    coords[tk[0]] = (round(ddmm(float(tk[-3])), 4), round(ddmm(float(tk[-2])), 4))
                except ValueError:
                    pass
known = set(all_names) | set(coords)
stations_doc = {sid: {"name": all_names.get(sid, sid), "lat": coords[sid][0], "lon": coords[sid][1]}
                for sid in known if sid in coords}
json.dump(stations_doc, io.open(os.path.join(data_dir, "stations.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

# --- stats.json: nationaler Ueberblick ---
stats = {"generated_utc": run_utc}
if snap:
    hot, cold = snap[0], snap[-1]
    stats["hottest"] = {"name": hot["name"], "temp_c": hot["temp_c"]}
    stats["coldest"] = {"name": cold["name"], "temp_c": cold["temp_c"]}
    stats["spread_c"] = round(hot["temp_c"] - cold["temp_c"], 1)
    stats["station_count"] = len(snap)
if n >= 1 and date_list[-1] == today.strftime("%Y-%m-%d"):
    ti = n - 1
    rec = 0
    for sid, s in series.items():
        tm = s["max"][ti]
        if tm is None:
            continue
        prior = [v for v in s["max"][:ti] if v is not None]
        if prior and tm >= max(prior):
            rec += 1
    stats["records_today"] = rec
    if n >= 2:
        yi = n - 2
        best = worst = None
        for sid, s in series.items():
            a, b = s["max"][ti], s["max"][yi]
            if a is None or b is None:
                continue
            dlt = round(a - b, 1); nm = all_names.get(sid, sid)
            if best is None or dlt > best[1]:
                best = (nm, dlt)
            if worst is None or dlt < worst[1]:
                worst = (nm, dlt)
        if best:
            stats["top_riser"] = {"name": best[0], "delta_c": best[1]}
        if worst:
            stats["top_faller"] = {"name": worst[0], "delta_c": worst[1]}

# nationale Vorjahres-Anomalie: heutiges Tagesmax vs. selbes Kalenderdatum im Vorjahr
if n >= 1 and date_list[-1] == today.strftime("%Y-%m-%d"):
    try:
        ly = today.replace(year=today.year - 1)
    except ValueError:            # 29.2. -> 28.2.
        ly = today.replace(year=today.year - 1, day=28)
    dmap = dict(daily_data)
    cur_st = dmap.get(today.strftime("%Y-%m-%d"), {})
    ly_st = dmap.get(ly.strftime("%Y-%m-%d"), {})
    deltas = []
    for sid, e in cur_st.items():
        a = e.get("max_c")
        b = ly_st.get(sid, {}).get("max_c")
        if a is not None and b is not None:
            deltas.append(a - b)
    if deltas:
        stats["vs_last_year"] = {"date": ly.strftime("%Y-%m-%d"),
                                 "delta_c": round(sum(deltas) / len(deltas), 1),
                                 "n": len(deltas)}

json.dump(stats, io.open(os.path.join(data_dir, "stats.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

msg = "%d neue Messwerte" % len(fresh) if fresh else "keine neuen Messwerte"
print("   %s - latest/tops/series/stations/stats + daily aktualisiert" % msg, file=sys.stderr)
PY

# ---------------------------------------------------------------------------
# 5) Ausgabe
# ---------------------------------------------------------------------------
SORTED="$DATA/_sorted.tsv"
LC_ALL=C sort -t"$(printf '\t')" -k1,1 -rn "$RES" > "$SORTED"

# Kennzahlen
read_stats() {
  LC_ALL=C awk -F'\t' '
    { v[NR]=$1; sum+=$1 }
    NR==1 { hot=$1; hotn=$3 }
    END {
      n=NR; cold=v[n]
      med = (n%2)? v[int(n/2)+1] : (v[n/2]+v[n/2+1])/2
      printf "%d\t%.1f\t%.1f\t%.1f", n, hot, cold, med
    }' "$SORTED"
}
STATS="$(read_stats)"
N="${STATS%%$'\t'*}";       STATS="${STATS#*$'\t'}"
HOT="${STATS%%$'\t'*}";     STATS="${STATS#*$'\t'}"
COLD="${STATS%%$'\t'*}";    MED="${STATS#*$'\t'}"

# letzter Messzeitpunkt (aus heißester Zeile) -> Berlin-Zeit
HDR_RAW="$(head -1 "$SORTED" | awk -F'\t' '{print $4"\t"$5}')"
HDR_D="${HDR_RAW%%$'\t'*}"; HDR_U="${HDR_RAW#*$'\t'}"
LASTTIME="$(to_berlin "$HDR_D" "$HDR_U")"

echo
printf '%s\n' "${B}${RED}🌡  TEMPERATUR-LEADERBOARD DEUTSCHLAND${R}"
printf '%s\n' "${DIM}   Quelle: DWD OpenData · Stand ~${LASTTIME} ${TZ_ABBR} · ${N} Stationen${R}"
printf '%s\n' "${DIM}   ───────────────────────────────────────────────────────────${R}"

print_table() {
  # $1 = datei (bereits sortiert), $2 = limit (0=alle), $3 = modus (hot|cold)
  # Zeit wird je angezeigter Zeile von UTC nach Berlin umgerechnet.
  local limit="$2" mode="$3" rank=0
  local temp id name d u medal col ip berlin
  while IFS=$(printf '\t') read -r temp id name d u; do
    rank=$((rank + 1))
    [ "$limit" -gt 0 ] && [ "$rank" -gt "$limit" ] && break
    case "$rank" in
      1) medal="🥇" ;;
      2) medal="🥈" ;;
      3) medal="🥉" ;;
      *) medal="$(printf '%2d.' "$rank")" ;;
    esac
    if [ "$mode" = "cold" ]; then
      col="$BLU"
    else
      ip="${temp%.*}"
      if   [ "$ip" -ge 30 ] 2>/dev/null; then col="$RED"
      elif [ "$ip" -ge 25 ] 2>/dev/null; then col="$YEL"
      else col="$CYAN"; fi
    fi
    berlin="$(to_berlin "$d" "$u")"
    printf '   %-4s %s%6.1f °C%s  %-22s %s%s%s\n' \
      "$medal" "$col" "$temp" "$R" "$name" "$DIM" "$berlin" "$R"
  done < "$1"
}

print_table "$SORTED" "$TOP" "hot"

if [ "$SHOW_COLD" -eq 1 ]; then
  printf '%s\n' "${DIM}   ───────────────── ❄  am kältesten ─────────────────${R}"
  LC_ALL=C sort -t"$(printf '\t')" -k1,1 -n "$RES" | head -10 > "$DATA/_cold.tsv"
  print_table "$DATA/_cold.tsv" 10 "cold"
  rm -f "$DATA/_cold.tsv"
fi

printf '%s\n' "${DIM}   ───────────────────────────────────────────────────────────${R}"
printf "   ${B}heißeste${R} %.1f°C   ${B}kälteste${R} %.1f°C   ${B}median${R} %.1f°C\n" "$HOT" "$COLD" "$MED"
printf '%s\n' "${DIM}   Daten unter web/public/data/ · latest.json · tops.json · history.csv · daily/${R}"
echo

# Aufräumen der internen Temp-Dateien
rm -f "$RES" "$SORTED"
