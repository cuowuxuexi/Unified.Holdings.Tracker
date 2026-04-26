#!/usr/bin/env bash
set -Eeuo pipefail

# UHT source-data scheduler wrapper.
# This host-side wrapper intentionally uses the same one-off container write
# gate that M8.3 verified: docker compose run --rm --no-deps, tracker-data
# mounted at /fact-write, DATABASE_URL=file:/fact-write/portfolio.db,
# UHT_BACKFILL_ISOLATED_ROOT=/fact-write, and --confirm-isolated-db portfolio.db.
# Default live domains stay on the proven market_quote,index lane; any wider
# domain set must be an explicit operator opt-in via UHT_SCHEDULER_DOMAINS.

DEFAULT_PORTFOLIO_ID="a3c29c28-7a1f-402d-a36d-ca85f5f8276a"
DEFAULT_LOOKBACK_DAYS="5"
DEFAULT_MAX_ROWS="256"
DEFAULT_LOG_ROOT="/root/tracker/uht-source-data-scheduler-logs"
DEFAULT_BACKUP_ROOT="/root/tracker/uht-db-backups"
DEFAULT_DB_VOLUME="tracker-data"
DEFAULT_FACT_MOUNT="/fact-write"
DEFAULT_DB_NAME="portfolio.db"
DEFAULT_ALLOWED_DOMAINS="market_quote,index"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORTFOLIO_ID="${UHT_SCHEDULER_PORTFOLIO_ID:-${DEFAULT_PORTFOLIO_ID}}"
LOOKBACK_DAYS="${UHT_SCHEDULER_LOOKBACK_DAYS:-${DEFAULT_LOOKBACK_DAYS}}"
DATE_TO="${UHT_SCHEDULER_DATE_TO:-$(date -d 'yesterday' +%F)}"
DATE_FROM="${UHT_SCHEDULER_DATE_FROM:-}"
MAX_ROWS="${UHT_SCHEDULER_MAX_ROWS:-${DEFAULT_MAX_ROWS}}"
LOG_ROOT="${UHT_SCHEDULER_LOG_ROOT:-${DEFAULT_LOG_ROOT}}"
BACKUP_ROOT="${UHT_SCHEDULER_BACKUP_ROOT:-${DEFAULT_BACKUP_ROOT}}"
DB_VOLUME="${UHT_SCHEDULER_DB_VOLUME:-${DEFAULT_DB_VOLUME}}"
FACT_MOUNT="${UHT_SCHEDULER_FACT_MOUNT:-${DEFAULT_FACT_MOUNT}}"
DB_NAME="${UHT_SCHEDULER_DB_NAME:-${DEFAULT_DB_NAME}}"
DOMAINS="${UHT_SCHEDULER_DOMAINS:-${DEFAULT_ALLOWED_DOMAINS}}"
COMPOSE_FILE="${UHT_SCHEDULER_COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
HOST_DB_PATH="${UHT_SCHEDULER_HOST_DB_PATH:-/var/lib/docker/volumes/${DB_VOLUME}/_data/${DB_NAME}}"
DRY_RUN_ONLY="${UHT_SCHEDULER_DRY_RUN_ONLY:-0}"

RUN_STAMP="$(date +%Y%m%dT%H%M%S%z)"
RUN_DIR="${LOG_ROOT}/uht-source-data-${RUN_STAMP}"

mkdir -p "${RUN_DIR}" "${BACKUP_ROOT}"

exec > >(tee -a "${RUN_DIR}/wrapper.stdout.log") 2> >(tee -a "${RUN_DIR}/wrapper.stderr.log" >&2)

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

validate_positive_integer() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || fail "${name} must be a positive integer, got: ${value}"
}

validate_date() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "${name} must be YYYY-MM-DD, got: ${value}"
  date -d "${value}" +%F >/dev/null 2>&1 || fail "${name} is not a valid calendar date: ${value}"
}

normalize_domains() {
  local raw="$1"
  python3 - "${raw}" <<'PY'
import sys

allowed = {'fx', 'market_quote', 'index', 'yield_curve', 'macro'}
items = [item.strip() for item in sys.argv[1].split(',') if item.strip()]
if not items:
    print('UHT_SCHEDULER_DOMAINS must include at least one domain', file=sys.stderr)
    sys.exit(1)

normalized = []
invalid = []
for item in items:
    if item not in allowed:
        invalid.append(item)
        continue
    if item not in normalized:
        normalized.append(item)

if invalid:
    print(f"UHT_SCHEDULER_DOMAINS includes unsupported domain(s): {', '.join(invalid)}", file=sys.stderr)
    sys.exit(1)

print(','.join(normalized))
PY
}

calculate_date_from() {
  local date_to="$1"
  local lookback_days="$2"
  date -d "${date_to} -$((lookback_days - 1)) day" +%F
}

init_inputs() {
  require_command date
  require_command docker
  require_command python3
  require_command cp

  validate_positive_integer "UHT_SCHEDULER_LOOKBACK_DAYS" "${LOOKBACK_DAYS}"
  if (( LOOKBACK_DAYS < 3 || LOOKBACK_DAYS > 5 )); then
    fail "UHT_SCHEDULER_LOOKBACK_DAYS must stay within the M8.4 safety window 3..5, got: ${LOOKBACK_DAYS}"
  fi

  validate_positive_integer "UHT_SCHEDULER_MAX_ROWS" "${MAX_ROWS}"
  validate_date "UHT_SCHEDULER_DATE_TO" "${DATE_TO}"
  if [[ -z "${DATE_FROM}" ]]; then
    DATE_FROM="$(calculate_date_from "${DATE_TO}" "${LOOKBACK_DAYS}")"
  fi
  validate_date "UHT_SCHEDULER_DATE_FROM" "${DATE_FROM}"
  if [[ "${DATE_FROM}" > "${DATE_TO}" ]]; then
    fail "UHT_SCHEDULER_DATE_FROM must be earlier than or equal to UHT_SCHEDULER_DATE_TO"
  fi

  [[ "${DB_NAME}" == "portfolio.db" ]] || fail "UHT_SCHEDULER_DB_NAME must remain portfolio.db for the confirmed write gate"
  [[ "${FACT_MOUNT}" == "/fact-write" ]] || fail "UHT_SCHEDULER_FACT_MOUNT must remain /fact-write for the confirmed write gate"
  [[ -f "${COMPOSE_FILE}" ]] || fail "compose file not found: ${COMPOSE_FILE}"
  DOMAINS="$(normalize_domains "${DOMAINS}")" || fail "invalid UHT_SCHEDULER_DOMAINS: ${DOMAINS}"
}

compose_base() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

run_in_backend_container() {
  compose_base run --rm --no-deps \
    -v "${DB_VOLUME}:${FACT_MOUNT}" \
    -e "DATABASE_URL=file:${FACT_MOUNT}/${DB_NAME}" \
    -e "UHT_BACKFILL_ISOLATED_ROOT=${FACT_MOUNT}" \
    backend "$@"
}

collect_counts() {
  local output_file="$1"
  local stderr_file="$2"

  run_in_backend_container node <<'NODE' >"${output_file}" 2>"${stderr_file}"
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const models = [
  ['Asset', 'asset'],
  ['AttentionItem', 'attentionItem'],
  ['ExchangeRateSnapshot', 'exchangeRateSnapshot'],
  ['IndexSnapshot', 'indexSnapshot'],
  ['MacroIndicatorSnapshot', 'macroIndicatorSnapshot'],
  ['Portfolio', 'portfolio'],
  ['PortfolioSnapshot', 'portfolioSnapshot'],
  ['PositionSnapshot', 'positionSnapshot'],
  ['QuoteSnapshot', 'quoteSnapshot'],
  ['SourceHealth', 'sourceHealth'],
  ['SourceRun', 'sourceRun'],
  ['Transaction', 'transaction'],
  ['YieldCurveSnapshot', 'yieldCurveSnapshot'],
];

(async () => {
  const counts = {};
  for (const [tableName, modelName] of models) {
    counts[tableName] = await prisma[modelName].count();
  }
  console.log(JSON.stringify(counts, null, 2));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
}

write_count_diff() {
  local before_file="$1"
  local after_file="$2"
  local output_file="$3"

  python3 - "${before_file}" "${after_file}" "${output_file}" <<'PY'
import json
import sys

before_path, after_path, output_path = sys.argv[1:4]
with open(before_path, encoding='utf-8') as fh:
    before = json.load(fh)
with open(after_path, encoding='utf-8') as fh:
    after = json.load(fh)

diff = {}
for key in sorted(set(before) | set(after)):
    before_value = before.get(key)
    after_value = after.get(key)
    if before_value != after_value:
        diff[key] = {'before': before_value, 'after': after_value, 'delta': after_value - before_value}

with open(output_path, 'w', encoding='utf-8') as fh:
    json.dump(diff, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
PY
}

assert_empty_count_diff() {
  local diff_file="$1"
  python3 - "${diff_file}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as fh:
    diff = json.load(fh)
if diff:
    print(json.dumps({'unexpectedCountDiff': diff}, ensure_ascii=False, indent=2), file=sys.stderr)
    sys.exit(1)
PY
}

assert_allowed_write_count_diff() {
  local diff_file="$1"
  local expected_domains="$2"
  python3 - "${diff_file}" "${expected_domains}" <<'PY'
import json
import sys

allowed_by_domain = {
    'fx': 'ExchangeRateSnapshot',
    'market_quote': 'QuoteSnapshot',
    'index': 'IndexSnapshot',
    'yield_curve': 'YieldCurveSnapshot',
    'macro': 'MacroIndicatorSnapshot',
}
domains = [item.strip() for item in sys.argv[2].split(',') if item.strip()]
allowed = {'SourceRun', 'SourceHealth'}
allowed.update(allowed_by_domain[domain] for domain in domains)
with open(sys.argv[1], encoding='utf-8') as fh:
    diff = json.load(fh)
disallowed = {key: value for key, value in diff.items() if key not in allowed}
if disallowed:
    print(json.dumps({'disallowedCountDiff': disallowed}, ensure_ascii=False, indent=2), file=sys.stderr)
    sys.exit(1)
print(json.dumps({'allowedCountDiff': diff}, ensure_ascii=False, indent=2))
PY
}

assert_dry_run_report_safe() {
  local report_file="$1"
  local expected_domains="$2"
  python3 - "${report_file}" "${expected_domains}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as fh:
    report = json.load(fh)
expected_domains = [item.strip() for item in sys.argv[2].split(',') if item.strip()]

errors = []
if report.get('mode') != 'dry-run':
    errors.append(f"mode={report.get('mode')!r}")
if report.get('writeAttempted') is not False:
    errors.append(f"writeAttempted={report.get('writeAttempted')!r}")
if report.get('domains') != expected_domains:
    errors.append(f"domains={report.get('domains')!r}")
verification = report.get('countVerification') or {}
if verification.get('unchanged') is not True:
    errors.append(f"countVerification.unchanged={verification.get('unchanged')!r}")
if verification.get('changedTables') != []:
    errors.append(f"countVerification.changedTables={verification.get('changedTables')!r}")

if errors:
    print(json.dumps({'dryRunGateFailed': errors}, ensure_ascii=False, indent=2), file=sys.stderr)
    sys.exit(1)
PY
}

assert_write_report_safe() {
  local report_file="$1"
  local expected_domains="$2"
  python3 - "${report_file}" "${expected_domains}" <<'PY'
import json
import sys

allowed_by_domain = {
    'fx': 'ExchangeRateSnapshot',
    'market_quote': 'QuoteSnapshot',
    'index': 'IndexSnapshot',
    'yield_curve': 'YieldCurveSnapshot',
    'macro': 'MacroIndicatorSnapshot',
}
expected_domains = [item.strip() for item in sys.argv[2].split(',') if item.strip()]
allowed = {'SourceRun', 'SourceHealth'}
allowed.update(allowed_by_domain[domain] for domain in expected_domains)
with open(sys.argv[1], encoding='utf-8') as fh:
    report = json.load(fh)

errors = []
if report.get('mode') != 'isolated-write':
    errors.append(f"mode={report.get('mode')!r}")
if report.get('domains') != expected_domains:
    errors.append(f"domains={report.get('domains')!r}")
if report.get('writeAttempted') is not True:
    errors.append(f"writeAttempted={report.get('writeAttempted')!r}")
verification = report.get('countVerification') or {}
changed = set(verification.get('changedTables') or [])
disallowed = sorted(changed - allowed)
if disallowed:
    errors.append(f"disallowed report changedTables={disallowed!r}")
blocked_codes = [item.get('code') for item in report.get('blocked') or []]
fatal_codes = {'portfolio_not_found', 'max_rows_exceeded', 'dry_run_count_changed', 'isolated_write_fact_count_changed', 'fail_on_missing_config'}
fatal = [code for code in blocked_codes if code in fatal_codes]
if fatal:
    errors.append(f"fatal blocked codes={fatal!r}")

if errors:
    print(json.dumps({'writeGateFailed': errors}, ensure_ascii=False, indent=2), file=sys.stderr)
    sys.exit(1)
PY
}

extract_runner_report() {
  local stdout_file="$1"
  local report_file="$2"

  python3 - "${stdout_file}" "${report_file}" <<'PY'
import json
import sys
from pathlib import Path

stdout_path = Path(sys.argv[1])
report_path = Path(sys.argv[2])
text = stdout_path.read_text(encoding='utf-8', errors='replace')
decoder = json.JSONDecoder()
required_keys = {'mode', 'status', 'writeAttempted', 'domains', 'countVerification'}
candidates = []
index = 0

while True:
    index = text.find('{', index)
    if index == -1:
        break
    try:
        value, _end = decoder.raw_decode(text[index:])
    except json.JSONDecodeError:
        index += 1
        continue
    if isinstance(value, dict) and required_keys.issubset(value):
        candidates.append((index, value))
    index += 1

if not candidates:
    print(
        json.dumps(
            {
                'runnerReportParseFailed': {
                    'stdoutFile': str(stdout_path),
                    'requiredKeys': sorted(required_keys),
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        file=sys.stderr,
    )
    sys.exit(1)

_offset, report = candidates[-1]
tmp_path = report_path.with_suffix(report_path.suffix + '.tmp')
with tmp_path.open('w', encoding='utf-8') as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
tmp_path.replace(report_path)
PY
}

run_backfill() {
  local mode="$1"
  shift
  local stdout_file="${RUN_DIR}/${mode}.stdout.log"
  local stderr_file="${RUN_DIR}/${mode}.stderr.log"
  local report_file="${RUN_DIR}/${mode}.report.json"

  log "running ${mode} backfill for ${DATE_FROM}..${DATE_TO}, domains=${DOMAINS}, maxRows=${MAX_ROWS}"
  run_in_backend_container node dist/backfill-source-data.js \
    --portfolio-id "${PORTFOLIO_ID}" \
    --date-from "${DATE_FROM}" \
    --date-to "${DATE_TO}" \
    --domains "${DOMAINS}" \
    --max-rows "${MAX_ROWS}" \
    --allow-source-fetch \
    "$@" \
    >"${stdout_file}" 2>"${stderr_file}"

  extract_runner_report "${stdout_file}" "${report_file}"
  log "${mode} stdout saved: ${stdout_file}"
  log "${mode} report saved: ${report_file}"
}

backup_database() {
  [[ -f "${HOST_DB_PATH}" ]] || fail "production DB file not found for backup: ${HOST_DB_PATH}"
  local backup_file="${BACKUP_ROOT}/portfolio-pre-uht-source-data-scheduler-${RUN_STAMP}.db"
  cp -p "${HOST_DB_PATH}" "${backup_file}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${backup_file}" >"${backup_file}.sha256"
  fi
  printf '%s\n' "${backup_file}" >"${RUN_DIR}/backup.path.txt"
  log "database backup saved: ${backup_file}"
}

main() {
  cd "${REPO_ROOT}"
  init_inputs

  log "UHT source-data scheduler started"
  log "repoRoot=${REPO_ROOT}"
  log "runDir=${RUN_DIR}"
  log "portfolioId=${PORTFOLIO_ID}"
  log "dateFrom=${DATE_FROM} dateTo=${DATE_TO} lookbackDays=${LOOKBACK_DAYS}"
  log "domains=${DOMAINS}"
  log "composeFile=${COMPOSE_FILE} dbVolume=${DB_VOLUME} factMount=${FACT_MOUNT}"

  collect_counts "${RUN_DIR}/pre-dry-run-counts.json" "${RUN_DIR}/pre-dry-run-counts.stderr.log"
  run_backfill dry-run --dry-run
  assert_dry_run_report_safe "${RUN_DIR}/dry-run.report.json" "${DOMAINS}"
  collect_counts "${RUN_DIR}/post-dry-run-counts.json" "${RUN_DIR}/post-dry-run-counts.stderr.log"
  write_count_diff "${RUN_DIR}/pre-dry-run-counts.json" "${RUN_DIR}/post-dry-run-counts.json" "${RUN_DIR}/dry-run-count-diff.json"
  assert_empty_count_diff "${RUN_DIR}/dry-run-count-diff.json"
  log "dry-run gate passed: countVerification.unchanged=true and changedTables=[]"

  if [[ "${DRY_RUN_ONLY}" == "1" || "${DRY_RUN_ONLY}" == "true" ]]; then
    log "UHT_SCHEDULER_DRY_RUN_ONLY=${DRY_RUN_ONLY}; write step skipped by explicit operator override"
    log "UHT source-data scheduler finished in dry-run-only mode"
    return 0
  fi

  cp "${RUN_DIR}/post-dry-run-counts.json" "${RUN_DIR}/pre-write-counts.json"
  backup_database
  run_backfill write --write --allow-isolated-write --allow-fact-write --confirm-isolated-db "${DB_NAME}"
  assert_write_report_safe "${RUN_DIR}/write.report.json" "${DOMAINS}"
  collect_counts "${RUN_DIR}/post-write-counts.json" "${RUN_DIR}/post-write-counts.stderr.log"
  write_count_diff "${RUN_DIR}/pre-write-counts.json" "${RUN_DIR}/post-write-counts.json" "${RUN_DIR}/write-count-diff.json"
  cp "${RUN_DIR}/write-count-diff.json" "${RUN_DIR}/count-diff.json"
  assert_allowed_write_count_diff "${RUN_DIR}/write-count-diff.json" "${DOMAINS}" >"${RUN_DIR}/allowed-count-diff.json"

  log "write guard passed: only SourceRun/SourceHealth/QuoteSnapshot/IndexSnapshot counts changed"
  log "UHT source-data scheduler finished successfully"
}

main "$@"
