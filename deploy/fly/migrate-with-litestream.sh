#!/bin/sh
# Historical filename retained for operator compatibility; no Litestream runs.
set -eu
app_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
data_dir=${APP_DATA_DIR:-/data}
case "$data_dir" in /*) ;; *) echo 'APP_DATA_DIR must be absolute.' >&2; exit 1 ;; esac
if [ ! -f "$data_dir/app.db" ]; then
  echo 'Existing app.db required; this command does not restore a missing database.' >&2
  exit 1
fi
cd "$app_root"
export APP_DATA_DIR="$data_dir"
# The worker validates a retained pre-release receipt before opening SQLite,
# then starts private backup access only after migration has succeeded.
exec node --import tsx scripts/migrate-hosted-database.ts "$@"
