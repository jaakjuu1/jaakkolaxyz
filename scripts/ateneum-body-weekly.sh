#!/usr/bin/env bash
set -euo pipefail
ENV_FILE=/home/clawdbot/jaakkolaxyz/.env
SECRET=$(
  python3 - <<'PY'
from pathlib import Path
for line in Path("/home/clawdbot/jaakkolaxyz/.env").read_text().splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k, v = s.split("=", 1)
    if k.strip() == "ATENEUM_CRON_SECRET":
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        print(v, end="")
        break
PY
)
if [ -z "${SECRET}" ]; then
  echo "ATENEUM_CRON_SECRET missing" >&2
  exit 1
fi
curl -fsS -X POST \
  -H "X-Ateneum-Cron-Secret: ${SECRET}" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:5000/api/ateneum/body-practice/weekly-run
echo
