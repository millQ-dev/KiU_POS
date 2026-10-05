#!/usr/bin/env bash
# Shell-level validation for Origin → GitHub backup GitHub App auth.
# Does not print JWTs, installation tokens, or private keys.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/backup-origin-to-github.sh"

assert_eq() {
  local left="$1" right="$2" msg="$3"
  if [[ "${left}" != "${right}" ]]; then
    echo "FAIL: ${msg}" >&2
    echo "  left=${left}" >&2
    echo "  right=${right}" >&2
    exit 1
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    echo "FAIL: ${msg}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "FAIL: ${msg}" >&2
    exit 1
  fi
}

fail_if_leaked() {
  local text="$1"
  if grep -Eq 'BEGIN (RSA )?PRIVATE KEY|-----BEGIN' <<<"${text}"; then
    echo "FAIL: private key material appeared in output" >&2
    exit 1
  fi
  if grep -Eq 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<<"${text}"; then
    echo "FAIL: JWT-shaped secret appeared in output" >&2
    exit 1
  fi
  if grep -Eq 'ghs_[A-Za-z0-9]+|ghu_[A-Za-z0-9]+' <<<"${text}"; then
    echo "FAIL: GitHub token appeared in output" >&2
    exit 1
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

key_file="${tmpdir}/test.pem"
openssl genrsa -out "${key_file}" 2048 >/dev/null 2>&1
pub_file="${tmpdir}/test.pub"
openssl rsa -in "${key_file}" -pubout -out "${pub_file}" >/dev/null 2>&1
GITHUB_APP_PRIVATE_KEY="$(cat "${key_file}")"
export GITHUB_APP_PRIVATE_KEY
export GITHUB_APP_ID="123456"
export GITHUB_APP_INSTALLATION_ID="654321"

echo "== missing env fails before GitHub push =="
(
  unset GITHUB_APP_ID GITHUB_APP_INSTALLATION_ID GITHUB_APP_PRIVATE_KEY ORIGIN_URL
  export ORIGIN_URL="https://origin.cursor.com/git/millqdev/MillQ.git"
  set +e
  out="$(millq_backup_require_github_app_env 2>&1)"
  rc=$?
  set -e
  assert_eq "${rc}" "1" "missing GitHub App env must fail"
  assert_contains "${out}" "refusing anonymous GitHub push" "must refuse anonymous push"
  fail_if_leaked "${out}"
)

echo "== JWT signs with RS256 and is not logged by helper =="
WORKDIR="${tmpdir}/jwt"
mkdir -p "${WORKDIR}"
copied="${WORKDIR}/github-app.pem"
millq_backup_write_private_key "${copied}"
jwt="$(millq_backup_github_app_jwt "${copied}")"
[[ "${jwt}" == *.* ]] || { echo "FAIL: jwt missing dots" >&2; exit 1; }
header_b64="${jwt%%.*}"
rest="${jwt#*.}"
payload_b64="${rest%%.*}"
sig_b64="${rest#*.}"
python3 - "${header_b64}" "${payload_b64}" "${sig_b64}" "${pub_file}" <<'PY'
import base64, json, subprocess, sys, tempfile, os

def b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + pad)

header, payload, sig, pub = sys.argv[1:5]
hdr = json.loads(b64url_decode(header))
pl = json.loads(b64url_decode(payload))
assert hdr["alg"] == "RS256"
assert pl["iss"] == "123456"
assert "exp" in pl and "iat" in pl
unsigned = f"{header}.{payload}".encode()
sig_raw = b64url_decode(sig)
with tempfile.NamedTemporaryFile(delete=False) as sf:
    sf.write(sig_raw)
    sig_path = sf.name
with tempfile.NamedTemporaryFile(delete=False) as uf:
    uf.write(unsigned)
    unsigned_path = uf.name
try:
    subprocess.check_call(
        ["openssl", "dgst", "-sha256", "-verify", pub, "-signature", sig_path, unsigned_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
finally:
    os.unlink(sig_path)
    os.unlink(unsigned_path)
PY

echo "== fake curl + git: authenticated main and tags push =="
fakes="${tmpdir}/fakes"
mkdir -p "${fakes}"
cat >"${fakes}/curl" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
out="/dev/null"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    -H)
      if [[ "$2" == Authorization:\ Bearer\ * ]]; then
        printf 'auth=bearer\n' >>"${FAKE_LOG}"
      fi
      shift 2
      ;;
    -X) shift 2 ;;
    -sS) shift ;;
    *)
      printf 'url=%s\n' "$1" >>"${FAKE_LOG}"
      shift
      ;;
  esac
done
printf '{"token":"ghs_testinstallationtokenvalue","expires_at":"2099-01-01T00:00:00Z"}' >"${out}"
printf '201'
EOS
chmod +x "${fakes}/curl"

cat >"${fakes}/git" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
extraheader=""
dir=""
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) dir="$2"; shift 2 ;;
    -c)
      if [[ "$2" == http.extraheader=* ]]; then
        extraheader="${2#http.extraheader=}"
        printf 'git_config=http.extraheader=redacted\n' >>"${FAKE_LOG}"
      else
        printf 'git_config=%s\n' "$2" >>"${FAKE_LOG}"
      fi
      shift 2
      ;;
    clone)
      dest="${*: -1}"
      mkdir -p "${dest}"
      printf 'clone dest=%s url=%s\n' "${dest}" "$2" >>"${FAKE_LOG}"
      exit 0
      ;;
    remote)
      printf 'remote %s\n' "$*" >>"${FAKE_LOG}"
      exit 0
      ;;
    push)
      if [[ -z "${extraheader}" ]]; then
        echo "No anonymous write access." >&2
        exit 128
      fi
      if [[ "${extraheader}" != AUTHORIZATION:\ basic\ * ]]; then
        echo "missing GitHub App basic auth extraheader" >&2
        exit 1
      fi
      printf 'push extraheader=present refs=%s\n' "$*" >>"${FAKE_LOG}"
      exit 0
      ;;
    rev-parse)
      echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      exit 0
      ;;
    ls-remote)
      if [[ -z "${extraheader}" ]]; then
        echo "anonymous ls-remote forbidden in test" >&2
        exit 1
      fi
      echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	refs/heads/main"
      exit 0
      ;;
    *)
      echo "unexpected git invocation: ${args[*]}" >&2
      exit 1
      ;;
  esac
done
EOS
chmod +x "${fakes}/git"

export FAKE_LOG="${tmpdir}/fake.log"
: >"${FAKE_LOG}"
export ORIGIN_URL="https://origin.cursor.com/git/millqdev/MillQ.git"
export GITHUB_URL="https://github.com/millQ-dev/KiU_POS.git"
export GITHUB_API_URL="https://example.invalid"
export WORKDIR="${tmpdir}/run"
export PATH="${fakes}:${PATH}"

out="$(millq_backup_run 2>&1)"
assert_contains "${out}" "backup ok: main=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "successful backup message"
fail_if_leaked "${out}"
fail_if_leaked "$(cat "${FAKE_LOG}")"
assert_contains "$(cat "${FAKE_LOG}")" "push extraheader=present refs=push github refs/heads/main:refs/heads/main" "must push main"
assert_contains "$(cat "${FAKE_LOG}")" "push extraheader=present refs=push github --tags" "must push tags"
assert_contains "$(cat "${FAKE_LOG}")" "url=${GITHUB_API_URL}/app/installations/654321/access_tokens" "must exchange installation token"
assert_contains "$(cat "${FAKE_LOG}")" "auth=bearer" "JWT must be sent as bearer to API"
assert_not_contains "$(cat "${FAKE_LOG}")" "ghs_testinstallationtokenvalue" "installation token must not be logged"

echo "== token HTTP failure is safe =="
cat >"${fakes}/curl" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
out="/dev/null"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
printf '{"message":"Bad credentials"}' >"${out}"
printf '401'
EOS
chmod +x "${fakes}/curl"
export WORKDIR="${tmpdir}/run-fail"
hash -r
set +e
out="$(millq_backup_run 2>&1)"
rc=$?
set -e
assert_eq "${rc}" "1" "token HTTP 401 must fail"
assert_contains "${out}" "installation token request failed" "must report token failure"
fail_if_leaked "${out}"

echo "OK"
