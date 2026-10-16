#!/bin/sh
# Start Duet dev: a second Duet used only to build and check Duet itself.
# It keeps its own folder (~/.duet-dev) and its own connection for AI tools, has an orange ring
# on its Dock icon and an orange mark in its top bar, and never opens a project by itself. The Duet a designer works in is not touched.
#
#   scripts/dev-duet.sh          build if needed, then start it
#   scripts/dev-duet.sh stop     close it
#
# Talk to it with the address and secret in ~/.duet-dev/session.json.

cd "$(git rev-parse --show-toplevel)" || exit 1
APP=src-tauri/target/debug/duet-app

running() { pgrep -f "DUET_DEV_MARK" >/dev/null 2>&1; }

if [ "$1" = "stop" ]; then
  pkill -f "DUET_DEV_MARK" && echo "Duet dev is closed." || echo "Duet dev was not running."
  exit 0
fi
if running; then
  echo "Duet dev is already running."
  exit 0
fi

# the ffmpeg that ships inside Duet has to be in place before the app builds
ls src-tauri/binaries/ffmpeg-* >/dev/null 2>&1 || scripts/fetch-ffmpeg || exit 1
cargo build --quiet --manifest-path src-tauri/Cargo.toml || { echo "The build failed."; exit 1; }

# The interface is served by the development server. Start one only if none is running.
if ! curl -s -o /dev/null http://localhost:1420/; then
  nohup npx vite >/tmp/duet-dev-vite.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://localhost:1420/ && break; sleep 1; done
fi

rm -f "$HOME/.duet-dev/session.json"
# the extra word is ignored by Duet; it is only there so this copy can be found and closed by name
DUET_DEV=1 nohup "$APP" DUET_DEV_MARK >/tmp/duet-dev.log 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -f "$HOME/.duet-dev/session.json" ] && break; sleep 1; done
[ -f "$HOME/.duet-dev/session.json" ] && echo "Duet dev is running." || { echo "Duet dev did not start. See /tmp/duet-dev.log"; exit 1; }
