#!/usr/bin/env bash
# The one command: download/prepare -> synthesize -> candidates -> train -> export -> tune
# -> tools -> parity tests -> evaluate. Fixed seeds. About 25 minutes on an M-series Mac.
#   ./packages/letter-model/reproduce.sh            # everything
#   ./packages/letter-model/reproduce.sh --no-bench # skip the headless browser bench
set -euo pipefail
cd "$(dirname "$0")"
(cd ../pipeline && npm install --no-audit --no-fund --loglevel=error)
uv sync --frozen --quiet
exec uv run letter-model all "$@"
