#!/bin/bash
set -Eeuo pipefail
# Field/Study bootstrap. Runs with the tools supplied by macOS; no sudo/Homebrew/Git.
APP_BASE="${FIELD_STUDY_INSTALL_DIR:-$HOME/Library/Application Support/FieldStudy}"
BIN_BASE="${FIELD_STUDY_BIN_DIR:-$HOME/.local/bin}"
RELEASE='https://github.com/Wildandpeaceful/field-study/releases/latest/download'
ASSET='FieldStudy-macOS-arm64.zip'
NO_OPEN=0
ARCHIVE=''
FOLDER=''
PREVIEW=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --preview) PREVIEW=1 ;;
    --no-open) NO_OPEN=1 ;;
    --update) ;;
    --archive) shift; ARCHIVE="${1:?Missing ZIP path}" ;;
    --from-folder) shift; FOLDER="${1:?Missing folder path}" ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
COLOR=''; RESET=''
if [ -t 1 ] && [ -z "${NO_COLOR+x}" ]; then COLOR=$'\033[38;5;191m'; RESET=$'\033[0m'; fi
printf '%s\n' "${COLOR}" '   +-------------------------------+' '   |  F I E L D / S T U D Y         |' '   |  [ ] [ ] [ ]   /   MAKE ART   |' "   +-------------------------------+${RESET}" '' '   Your photos. Your words. Your cover.' ''
if [ "$PREVIEW" -eq 1 ]; then exit 0; fi
STAGE='Checking this Mac'
LOG_DIR="${FIELD_STUDY_LOG_DIR:-$HOME/Library/Logs/FieldStudy}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S)-$$.log"
exec > >(tee -a "$LOG") 2>&1
trap 'code=$?; printf "\nCould not finish: %s (exit %s).\nLog: %s\n" "$STAGE" "$code" "$LOG" >&2; exit "$code"' ERR
printf '[1/5] Checking this Mac\n'
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  printf 'This release supports Apple-silicon Macs (M1 or newer). Intel, Windows and Linux are not supported.\n' >&2
  false
fi
MAC_VERSION="$(sw_vers -productVersion)"
if [ "${MAC_VERSION%%.*}" -lt 14 ]; then printf 'macOS 14 or newer is required.\n' >&2; false; fi
# Refuse to replace an unrelated user's command or directory.
if [ -e "$BIN_BASE/field-study" ] && ! grep -q '^# FieldStudy managed launcher$' "$BIN_BASE/field-study"; then
  printf 'An unrelated command exists at %s. Choose FIELD_STUDY_BIN_DIR.\n' "$BIN_BASE/field-study" >&2; false
fi
if [ -e "$APP_BASE/current" ] && [ ! -L "$APP_BASE/current" ]; then
  printf 'An unrelated directory exists at %s/current. Choose FIELD_STUDY_INSTALL_DIR.\n' "$APP_BASE" >&2; false
fi
mkdir -p "$APP_BASE/versions" "$BIN_BASE"
TEMP="$(mktemp -d "$APP_BASE/.install.XXXXXX")"
trap 'rm -rf -- "$TEMP"' EXIT
STAGE='Reading release information'
printf '[2/5] Finding the complete release\n'
if [ -n "$FOLDER" ]; then
  VERSION="$(cat "$FOLDER/VERSION")"
elif [ -n "$ARCHIVE" ]; then
  VERSION="$(unzip -p "$ARCHIVE" FieldStudy/VERSION)"
else
  curl -fLsS --retry 3 "$RELEASE/VERSION" -o "$TEMP/VERSION"
  VERSION="$(cat "$TEMP/VERSION")"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then printf 'Invalid release version.\n' >&2; false; fi
DEST="$APP_BASE/versions/$VERSION"
STAGE='Preparing and verifying the app'
printf '[3/5] Preparing Field/Study %s\n' "$VERSION"
if [ -d "$DEST" ]; then
  "$DEST/.runtime/python/bin/python3" -I -B "$DEST/scripts/verify-package.py"
  printf 'Reusing the verified installation.\n'
else
  if [ -n "$FOLDER" ]; then
    /usr/bin/ditto --norsrc "$FOLDER" "$TEMP/FieldStudy"
  else
    if [ -n "$ARCHIVE" ]; then
      cp "$ARCHIVE" "$TEMP/$ASSET"
      cp "$(dirname "$ARCHIVE")/SHA256SUMS" "$TEMP/SHA256SUMS"
    else
      printf 'Downloading about 55 MB: Python, local selection model, helper, icons and studio.\n'
      curl -fLsS --retry 3 "$RELEASE/SHA256SUMS" -o "$TEMP/SHA256SUMS"
      curl -fL --retry 3 "$RELEASE/$ASSET" -o "$TEMP/$ASSET"
    fi
    EXPECTED="$(awk -v name="$ASSET" '$2 == name {print $1}' "$TEMP/SHA256SUMS")"
    if [[ ! "$EXPECTED" =~ ^[0-9a-f]{64}$ ]]; then printf 'Missing release checksum.\n' >&2; false; fi
    printf '%s  %s\n' "$EXPECTED" "$ASSET" > "$TEMP/check.sha256"
    (cd "$TEMP" && shasum -a 256 -c check.sha256)
    /usr/bin/ditto -x -k "$TEMP/$ASSET" "$TEMP"
  fi
  PACKAGE="$TEMP/FieldStudy"
  "$PACKAGE/.runtime/python/bin/python3" -I -B "$PACKAGE/scripts/verify-package.py"
  [ "$(cat "$PACKAGE/VERSION")" = "$VERSION" ]
  mv "$PACKAGE" "$DEST"
fi
STAGE='Installing the launch command'
printf '[4/5] Installing the launch command\n'
ln -s "$DEST" "$TEMP/current"
"$DEST/.runtime/python/bin/python3" -I -B -c 'import os,sys; os.replace(sys.argv[1],sys.argv[2])' "$TEMP/current" "$APP_BASE/current"
{
  printf '%s\n' '#!/bin/bash' '# FieldStudy managed launcher' 'set -Eeuo pipefail'
  printf 'export FIELD_STUDY_INSTALL_DIR=%q\n' "$APP_BASE"
  printf 'export FIELD_STUDY_BIN_DIR=%q\n' "$BIN_BASE"
  printf 'export FIELD_STUDY_LOG_DIR=%q\n' "$LOG_DIR"
  printf 'exec %q "$@"\n' "$APP_BASE/current/field-study"
} > "$TEMP/field-study"
chmod +x "$TEMP/field-study"
mv "$TEMP/field-study" "$BIN_BASE/field-study"
STAGE='Starting the local studio'
printf '[5/5] Ready to make art\n\nLaunch: %s/field-study\nUpdate: %s/field-study update\n\n' "$BIN_BASE" "$BIN_BASE"
if [ "$NO_OPEN" -eq 1 ]; then "$BIN_BASE/field-study" --no-open; else "$BIN_BASE/field-study"; fi
