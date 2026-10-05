#!/usr/bin/env bash
# GitHub backup job for MillQ.
#
# Intended identity: GitHub App "MillQ Origin Backup" (installation token).
# This identity must be the sole GitHub ruleset bypass/allowlisted actor
# on both:
#   - branch ruleset: main (routine writes blocked)
#   - tag ruleset: release/protected tags (create/update/delete restricted)
# Developers, Implementation Agents, and Review Agents must not have
# either bypass and must not run this as development dual-write.
#
# Authenticates with a short-lived GitHub App JWT exchanged for an
# installation access token. Does not use a PAT or personal account.
#
# Backs up Origin main and Origin tags only. Does not mirror other branches.
# Never fetches or merges GitHub into Origin. Never force-push GitHub main.
#
# Required environment:
#   ORIGIN_URL
#   GITHUB_APP_ID
#   GITHUB_APP_INSTALLATION_ID
#   GITHUB_APP_PRIVATE_KEY
set -euo pipefail

ORIGIN_URL="${ORIGIN_URL:-}"
GITHUB_URL="${GITHUB_URL:-https://github.com/millQ-dev/KiU_POS.git}"
GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"
WORKDIR="${WORKDIR:-}"

millq_backup_log() {
  echo "$@" >&2
}

millq_backup_die() {
  millq_backup_log "$@"
  exit 1
}

millq_backup_require_origin_url() {
  if [[ -z "${ORIGIN_URL}" ]]; then
    millq_backup_die "ORIGIN_URL is required (https://origin.cursor.com/{owner}/MillQ.git)"
  fi
}

millq_backup_require_github_app_env() {
  local missing=0
  if [[ -z "${GITHUB_APP_ID:-}" ]]; then
    millq_backup_log "GITHUB_APP_ID is required"
    missing=1
  elif [[ ! "${GITHUB_APP_ID}" =~ ^[0-9]+$ ]]; then
    millq_backup_log "GITHUB_APP_ID must be numeric"
    missing=1
  fi
  if [[ -z "${GITHUB_APP_INSTALLATION_ID:-}" ]]; then
    millq_backup_log "GITHUB_APP_INSTALLATION_ID is required"
    missing=1
  elif [[ ! "${GITHUB_APP_INSTALLATION_ID}" =~ ^[0-9]+$ ]]; then
    millq_backup_log "GITHUB_APP_INSTALLATION_ID must be numeric"
    missing=1
  fi
  if [[ -z "${GITHUB_APP_PRIVATE_KEY:-}" ]]; then
    millq_backup_log "GITHUB_APP_PRIVATE_KEY is required"
    missing=1
  fi
  if [[ "${missing}" -ne 0 ]]; then
    millq_backup_die "GitHub App credentials missing or invalid; refusing anonymous GitHub push"
  fi
}

millq_backup_b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

millq_backup_write_private_key() {
  local dest="$1"
  local raw="${GITHUB_APP_PRIVATE_KEY}"
  if [[ "${raw}" == \"*\" ]]; then
    raw="${raw:1:$((${#raw} - 2))}"
  fi
  printf '%s' "${raw}" | sed 's/\\n/\n/g' >"${dest}"
  printf '\n' >>"${dest}"
  chmod 600 "${dest}"
  if ! grep -q -- "BEGIN .*PRIVATE KEY" "${dest}"; then
    millq_backup_die "GITHUB_APP_PRIVATE_KEY is not a PEM private key"
  fi
}

millq_backup_github_app_jwt() {
  local key_file="$1"
  local now iat exp header payload unsigned_token signature
  now="$(date +%s)"
  iat="$((now - 60))"
  exp="$((now + 540))"
  header="$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | millq_backup_b64url)"
  payload="$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' "${iat}" "${exp}" "${GITHUB_APP_ID}" | millq_backup_b64url)"
  unsigned_token="${header}.${payload}"
  signature="$(printf '%s' "${unsigned_token}" | openssl dgst -sha256 -sign "${key_file}" -binary | millq_backup_b64url)" || {
    millq_backup_die "failed to sign GitHub App JWT"
  }
  printf '%s' "${unsigned_token}.${signature}"
}

millq_backup_github_installation_token() {
  local jwt="$1"
  local body http_code token
  body="$(mktemp "${WORKDIR}/install-token.XXXXXX")"
  http_code="$(
    curl -sS -o "${body}" -w '%{http_code}' \
      -X POST \
      -H 'Accept: application/vnd.github+json' \
      -H "Authorization: Bearer ${jwt}" \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      "${GITHUB_API_URL}/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens"
  )" || millq_backup_die "GitHub App installation token request failed"
  if [[ "${http_code}" != "201" && "${http_code}" != "200" ]]; then
    millq_backup_die "GitHub App installation token request failed (HTTP ${http_code})"
  fi
  token="$(python3 - "${body}" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    sys.exit(2)
token = data.get("token")
if not isinstance(token, str) or not token:
    sys.exit(3)
print(token)
PY
  )" || millq_backup_die "GitHub App installation token response missing token"
  rm -f "${body}"
  printf '%s' "${token}"
}

millq_backup_git_basic_extraheader() {
  local token="$1"
  local b64
  b64="$(printf 'x-access-token:%s' "${token}" | openssl base64 -A)"
  printf 'AUTHORIZATION: basic %s' "${b64}"
}

millq_backup_git_github() {
  local extraheader="$1"
  shift
  git -c "http.extraheader=${extraheader}" "$@"
}

millq_backup_run() {
  # Secret values must never appear in traces.
  set +x
  unset GIT_TRACE GIT_CURL_VERBOSE || true
  export GIT_TERMINAL_PROMPT=0

  millq_backup_require_origin_url
  millq_backup_require_github_app_env

  if [[ -z "${WORKDIR}" ]]; then
    WORKDIR="$(mktemp -d)"
  else
    mkdir -p "${WORKDIR}"
  fi
  cleanup() { rm -rf "${WORKDIR}"; }
  trap cleanup EXIT

  local key_file jwt token extraheader origin_sha github_sha
  key_file="${WORKDIR}/github-app.pem"
  millq_backup_write_private_key "${key_file}"
  jwt="$(millq_backup_github_app_jwt "${key_file}")" || exit 1
  token="$(millq_backup_github_installation_token "${jwt}")" || exit 1
  if [[ -z "${token}" ]]; then
    millq_backup_die "GitHub App installation token was empty"
  fi
  extraheader="$(millq_backup_git_basic_extraheader "${token}")" || exit 1
  jwt=""
  token=""

  git clone --bare "${ORIGIN_URL}" "${WORKDIR}/millq.git"
  git -C "${WORKDIR}/millq.git" remote add github "${GITHUB_URL}"
  # Fast-forward only. Never force-push GitHub main. Origin clone is source.
  millq_backup_git_github "${extraheader}" -C "${WORKDIR}/millq.git" push github refs/heads/main:refs/heads/main
  millq_backup_git_github "${extraheader}" -C "${WORKDIR}/millq.git" push github --tags

  origin_sha="$(git -C "${WORKDIR}/millq.git" rev-parse refs/heads/main)"
  github_sha="$(
    millq_backup_git_github "${extraheader}" ls-remote "${GITHUB_URL}" refs/heads/main | awk '{print $1}'
  )"

  extraheader=""

  if [[ "${origin_sha}" != "${github_sha}" ]]; then
    millq_backup_die "backup SHA mismatch: origin=${origin_sha} github=${github_sha}"
  fi

  echo "backup ok: main=${origin_sha}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  millq_backup_run
fi
