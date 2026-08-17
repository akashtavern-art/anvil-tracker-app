#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -x "$SCRIPT_DIR/android/gradlew" ]; then
  exec "$SCRIPT_DIR/android/gradlew" "$@"
fi

if command -v gradle >/dev/null 2>&1; then
  if printf '%s ' "$@" | grep -q ' -p '; then
    exec gradle -p "$SCRIPT_DIR/android" "$@"
  fi
  exec gradle -p "$SCRIPT_DIR/android" "$@"
fi

echo "Gradle not available. Install Android Gradle plugin tooling (Android Studio or gradle) and retry." >&2
exit 1
