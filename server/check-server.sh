#!/usr/bin/env bash
# check-server.sh — ajetaan SSH:n yli stdin:stä komennolla `bash -s`.
# Tulostaa ensin ihmisluettavia rivejä, sitten yhden MARKER + JSON -rivin.
# MARKER = "JAXXY_BUNDLE_V1 " (turvaväli)
#
# Kerätyt kentät:
#   uptime           : uptime -p -t -s   (esim "9w 4d" tai "45 minutes")
#   disk_used_pct    : juuren käytetyn tilan prosentti
#   disk_free_pct    : juuren vapaan tilan prosentti
#   memory_used_pct  : käytetyn muistin prosentti
#   containers[]     : docker ps --format nimi + tila + image
#   restart_loops[]  : kontit joiden RestartCount > 5 (max 10)
#   failed_services  : systemd-yksiköiden määrä joissa tila 'failed'
#   kernel           : uname -r (esim "6.1.0-13-amd64")
#   loadavg          : 1/5/15min load average
#   os               : /etc/os-release PRETTY_NAME
#
# VAATII: docker-komento (kontit), systemctl (failed services).
# Ei tarvitse sudoa kunhan komento toimii käyttäjällä.

set -u

MARKER='JAXXY_BUNDLE_V1'

emit() { printf '%s\n' "$*"; }

# --- Safe wrappers: jokainen komento try/catch, ei kaada koko skriptiä ---

safe() {
  local label="$1"; shift
  local out
  out=$("$@" 2>/dev/null) || out=""
  [ -n "$out" ] && emit "[$label] $out"
}

# --- Keräys ---

emit "=== JAXXY server check @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Uptime (lyhyt muoto)
uptime_str=$(uptime -p 2>/dev/null | sed 's/^up //')
[ -z "$uptime_str" ] && uptime_str=$(uptime | sed -E 's/.*up +([^,]+),.*/\1/')
emit "uptime: $uptime_str"

# Kernel + loadavg
emit "kernel: $(uname -r 2>/dev/null)"
emit "loadavg: $(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')"

# OS
if [ -r /etc/os-release ]; then
  pretty=$(grep '^PRETTY_NAME=' /etc/os-release | head -1 | sed 's/PRETTY_NAME=//; s/"//g')
  emit "os: $pretty"
fi

# Disk used/free %
disk_used_pct=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%",""); print $5}')
[ -z "$disk_used_pct" ] && disk_used_pct=null
if [ "$disk_used_pct" = "null" ]; then
  disk_free_pct=null
else
  disk_free_pct=$(( 100 - disk_used_pct ))
fi
emit "disk_used_pct: $disk_used_pct"
emit "disk_free_pct: $disk_free_pct"

# Memory used %
mem_used_pct=null
if [ -r /proc/meminfo ]; then
  total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  if [ -n "$total" ] && [ -n "$avail" ] && [ "$total" -gt 0 ]; then
    used=$(( total - avail ))
    mem_used_pct=$(( used * 100 / total ))
  fi
fi
emit "memory_used_pct: $mem_used_pct"

# Docker-kontit
containers_json='[]'
container_count=0
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    # Jokainen kontti yhtenä JSON-objektina. Käytä pythonia (tai node) JSON-muotoiluun
    # koska awk-json on hirveää. Jos python puuttuu, käytetään node, jos sekin
    # puuttuu, fall back awk:iin.
    if command -v python3 >/dev/null 2>&1; then
      containers_json=$(docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | python3 -c "
import sys, json
out = []
for line in sys.stdin:
    line = line.rstrip('\n')
    if not line: continue
    parts = line.split('\t')
    if len(parts) < 3: continue
    name, status, image = parts[0], parts[1], parts[2]
    state = 'up' if 'Up' in status else ('exited' if 'Exited' in status else 'unknown')
    out.append({'name': name, 'state': state, 'status': status, 'image': image})
print(json.dumps(out))
")
    elif command -v node >/dev/null 2>&1; then
      containers_json=$(docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | node -e "
let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
  const arr = s.split('\n').filter(Boolean).map(line => {
    const [name, status, image] = line.split('\t');
    const state = status && status.startsWith('Up') ? 'up' : (status && status.startsWith('Exited') ? 'exited' : 'unknown');
    return { name, state, status, image };
  });
  console.log(JSON.stringify(arr));
});
")
    fi
    container_count=$(echo "$containers_json" | grep -o '"name"' | wc -l)
  else
    emit "docker: ei käytettävissä (info failed)"
  fi
else
  emit "docker: ei asennettu"
fi
emit "containers_count: $container_count"

# Restart-loops (Docker)
restart_loops_json='[]'
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then
    restart_loops_json=$(docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | python3 -c "
import sys, json, re
out = []
for line in sys.stdin:
    line = line.rstrip('\n')
    if not line: continue
    parts = line.split('\t')
    if len(parts) < 3: continue
    name, status, image = parts[0], parts[1], parts[2]
    m = re.search(r'\((\d+)\) ', status)
    if m and int(m.group(1)) > 5:
        out.append({'name': name, 'restart_count': int(m.group(1)), 'status': status, 'image': image})
print(json.dumps(out[:10]))
")
  fi
fi

# Failed systemd units
failed_count=0
if command -v systemctl >/dev/null 2>&1; then
  failed_count=$(systemctl --user --failed --no-legend 2>/dev/null | wc -l)
  if [ "$failed_count" -eq 0 ]; then
    failed_count=$(systemctl --failed --no-legend 2>/dev/null | wc -l)
  fi
fi
emit "failed_services: $failed_count"

# --- JSON-bundle ---
emit "$MARKER $(container_date=%s; date -u +%s)"

# Tulosta JSON yhtenä rivinä johonka ssh2 + Node helposti jäsentää.
# Käytetään pythonia varmistamaan kelvollinen JSON; node toissijaisena.
if command -v python3 >/dev/null 2>&1; then
python3 - <<PYEOF
import json
bundle = {
  "schema": "jaxxy-bundle-v1",
  "ts": $(date -u +%s),
  "uptime": "$uptime_str",
  "kernel": "$(uname -r 2>/dev/null | tr -d '"')",
  "loadavg": "$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')",
  "os": $(python3 -c "import json; print(json.dumps(open('/etc/os-release').read().split('PRETTY_NAME=')[1].split(chr(10))[0].strip('\"') if 'PRETTY_NAME=' in open('/etc/os-release').read() else ''))" 2>/dev/null || echo '""'),
  "disk_free_pct": $disk_free_pct,
  "disk_used_pct": $disk_used_pct,
  "memory_used_pct": $mem_used_pct,
  "container_count": $container_count,
  "containers": $containers_json,
  "restart_loops": $restart_loops_json,
  "failed_services_count": $failed_count,
}
print(json.dumps(bundle, ensure_ascii=False))
PYEOF
elif command -v node >/dev/null 2>&1; then
node -e '
const bundle = {
  schema: "jaxxy-bundle-v1",
  ts: Math.floor(Date.now()/1000),
  uptime: process.env.UPTIME || "",
  kernel: require("os").release(),
  disk_used_pct: isNaN(parseInt(process.env.DISK_USED,10)) ? null : 100 - parseInt(process.env.DISK_USED,10),
  memory_used_pct: isNaN(parseInt(process.env.MEM_USED,10)) ? null : parseInt(process.env.MEM_USED,10),
  container_count: parseInt(process.env.CONTAINER_COUNT || "0", 10),
  containers: [],
  restart_loops: [],
  failed_services_count: parseInt(process.env.FAILED || "0", 10),
};
console.log(JSON.stringify(bundle));
' 2>/dev/null
fi

exit 0
