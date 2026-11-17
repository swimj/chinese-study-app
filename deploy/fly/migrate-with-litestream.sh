#!/bin/sh
set -eu

app_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
data_dir=${APP_DATA_DIR:-/data}
config=$app_root/deploy/fly/litestream.yml
confirmed=false
for argument in "$@"; do
  case "$argument" in
    --confirm-app-stopped=true) confirmed=true ;;
    --litestream-config=/*) config=${argument#--litestream-config=} ;;
    *) echo "Unknown or invalid migration argument" >&2; exit 1 ;;
  esac
done
case "$data_dir" in /*) ;; *) echo 'APP_DATA_DIR must be absolute.' >&2; exit 1 ;; esac
if [ "$confirmed" != true ]; then
  echo 'Stop the app and workers, take a recovery point, then pass --confirm-app-stopped=true.' >&2
  exit 1
fi
if [ ! -f "$data_dir/app.db" ]; then
  echo 'Existing app.db required; this command does not restore a missing database.' >&2
  exit 1
fi
if [ -e "$data_dir/litestream.sock" ]; then
  echo 'Litestream socket already exists. Investigate the running process or stale socket before migration.' >&2
  exit 1
fi
cd "$app_root"
export APP_DATA_DIR="$data_dir"
# Keep the sole application writer offline while replication protects the WAL.
exec litestream replicate -config "$config" \
  -exec 'node --import tsx scripts/migrate-hosted-database.ts --confirm-app-stopped=true'
