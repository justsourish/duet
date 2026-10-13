#!/bin/sh
# Start the check copy: a second Duet used only to check work on Duet itself.
# It keeps its own folder (~/.duet-check) and its own connection for AI tools, has an orange mark
# in its top bar, and never opens a project by itself. The Duet a designer works in is not touched.
#
#   scripts/check-duet.sh          build if needed, then start it
#   scripts/check-duet.sh stop     close it
#
# Talk to it with the address and secret in ~/.duet-check/session.json.

cd "$(git rev-parse --show-toplevel)" || exit 1
APP=src-tauri/target/debug/duet-app

running() { pgrep -f "DUET_CHECK_COPY_MARK" >/dev/null 2>&1; }

if [ "$1" = "stop" ]; then
  pkill -f "DUET_CHECK_COPY_MARK" && echo "The check copy is closed." || echo "The check copy was not running."
  exit 0
fi
if running; then
  echo "The check copy is already running."
  exit 0
fi

cargo build --quiet --manifest-path src-tauri/Cargo.toml || { echo "The build failed."; exit 1; }

# The interface is served by the development server. Start one only if none is running.
if ! curl -s -o /dev/null http://localhost:1420/; then
  nohup npx vite >/tmp/duet-check-vite.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://localhost:1420/ && break; sleep 1; done
fi

rm -f "$HOME/.duet-check/session.json"
# the extra word is ignored by Duet; it is only there so this copy can be found and closed by name
DUET_CHECK=1 nohup "$APP" DUET_CHECK_COPY_MARK >/tmp/duet-check.log 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -f "$HOME/.duet-check/session.json" ] && break; sleep 1; done
[ -f "$HOME/.duet-check/session.json" ] && echo "The check copy is running." || { echo "The check copy did not start. See /tmp/duet-check.log"; exit 1; }
