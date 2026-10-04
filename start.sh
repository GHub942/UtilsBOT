#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5 or later is required." >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 5) ? 0 : 1)' || {
  echo "Node.js 22.5 or later is required." >&2
  exit 1
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Configure .env, then run this script again."
  exit 0
fi

if [ -t 0 ]; then
  read -r -p "Enable DEBUG logging for this session? [y/N] " debug_choice || debug_choice=""
else
  debug_choice=""
fi
case "$debug_choice" in
  [Yy]|[Yy][Ee][Ss]) export LOG_LEVEL=debug ;;
  *) export LOG_LEVEL=info ;;
esac

if [ ! -d node_modules ]; then
  npm ci
fi
npm run deploy

retries=0
while :; do
  if npm start; then
    exit 0
  fi
  retries=$((retries + 1))
  if [ "$retries" -ge 5 ]; then
    echo "The bot failed five times. Stopping." >&2
    exit 1
  fi
  echo "Crash detected; restarting in 10 seconds ($retries/5)..."
  sleep 10
done
