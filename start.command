#!/bin/bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
run_installer() {
  if [ -x "$ROOT/.runtime/python/bin/python3" ]; then
    /bin/bash "$ROOT/install.sh" --from-folder "$ROOT" "$@"
  else
    /bin/bash "$ROOT/install.sh" "$@"
  fi
}
if ! run_installer "$@"; then
  printf '\nField/Study could not start. See the message above.\n'
  if [ -t 0 ]; then read -r -p "Press Return to close." _; fi
  exit 1
fi
