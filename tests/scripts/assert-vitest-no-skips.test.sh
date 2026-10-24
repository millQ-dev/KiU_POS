#!/usr/bin/env bash
# Negative / positive scenarios for scripts/ci/assert-vitest-no-skips.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ASSERT="$ROOT/scripts/ci/assert-vitest-no-skips.mjs"
URL_ASSERT="$ROOT/scripts/ci/assert-disposable-database-url.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
expect_fail() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL expected failure: $name"
    fail=$((fail + 1))
  else
    echo "OK expect-fail: $name"
    pass=$((pass + 1))
  fi
}
expect_ok() {
  local name="$1"
  shift
  if "$@"; then
    echo "OK expect-ok: $name"
    pass=$((pass + 1))
  else
    echo "FAIL expected success: $name"
    fail=$((fail + 1))
  fi
}

cat >"$TMP/ok.json" <<'EOF'
{"numPassedTests":7,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"numTotalTests":7}
EOF
cat >"$TMP/skipped.json" <<'EOF'
{"numPassedTests":0,"numFailedTests":0,"numPendingTests":7,"numTodoTests":0,"numTotalTests":7}
EOF
cat >"$TMP/too_few.json" <<'EOF'
{"numPassedTests":3,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"numTotalTests":3}
EOF
cat >"$TMP/failed.json" <<'EOF'
{"numPassedTests":6,"numFailedTests":1,"numPendingTests":0,"numTodoTests":0,"numTotalTests":7}
EOF
echo 'not-json' >"$TMP/bad.json"

expect_ok "seven-pass" node "$ASSERT" "$TMP/ok.json" --min-passed=7 --label=pos
expect_fail "skipped-suite" node "$ASSERT" "$TMP/skipped.json" --min-passed=7 --label=pos
expect_fail "too-few-pass" node "$ASSERT" "$TMP/too_few.json" --min-passed=7 --label=pos
expect_fail "has-failed" node "$ASSERT" "$TMP/failed.json" --min-passed=7 --label=pos
expect_fail "bad-json" node "$ASSERT" "$TMP/bad.json" --min-passed=7 --label=pos
expect_fail "missing-file" node "$ASSERT" "$TMP/missing.json" --min-passed=7 --label=pos

expect_ok "url-migrate" node "$URL_ASSERT" "postgresql://millq_ci:x@127.0.0.1:5432/millq_migrate_runner_123"
expect_ok "url-pos" node "$URL_ASSERT" "postgresql://millq_ci:x@127.0.0.1:5432/millq_ci_pos_123"
expect_fail "url-millq-dev" node "$URL_ASSERT" "postgresql://millq:millq@127.0.0.1:5432/millq_dev"
expect_fail "url-empty" node "$URL_ASSERT" ""
expect_fail "url-shared" node "$URL_ASSERT" "postgresql://millq:millq@127.0.0.1:5432/millq_sec0_test"

echo "assert-vitest-no-skips.test.sh: pass=$pass fail=$fail"
if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
