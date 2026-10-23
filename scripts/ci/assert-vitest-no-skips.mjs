#!/usr/bin/env node
/**
 * Fail-closed gate for Vitest JSON reports.
 * Success only when: parse OK, failed=0, skipped/pending/todo=0, passed >= min.
 *
 * Usage:
 *   node scripts/ci/assert-vitest-no-skips.mjs <report.json> --min-passed=N [--label=NAME]
 */
import { readFileSync } from 'node:fs';

function die(msg) {
  console.error(`assert-vitest-no-skips: FAIL: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { file: null, minPassed: null, label: 'suite' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--min-passed=')) {
      args.minPassed = Number(a.slice('--min-passed='.length));
    } else if (a.startsWith('--label=')) {
      args.label = a.slice('--label='.length);
    } else if (!a.startsWith('-') && !args.file) {
      args.file = a;
    } else {
      die(`unknown argument: ${a}`);
    }
  }
  return args;
}

function countByStatus(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) countByStatus(item, acc);
    return;
  }
  const status = typeof node.status === 'string' ? node.status.toLowerCase() : '';
  if (status) {
    if (status === 'pass' || status === 'passed') acc.passed += 1;
    else if (status === 'fail' || status === 'failed') acc.failed += 1;
    else if (
      status === 'skip' ||
      status === 'skipped' ||
      status === 'pending' ||
      status === 'todo'
    ) {
      acc.skipped += 1;
    }
  }
  for (const v of Object.values(node)) countByStatus(v, acc);
}

export function assertVitestReport(report, { minPassed, label = 'suite' }) {
  if (report == null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error(`${label}: report must be a JSON object`);
  }

  const numPassed = Number(report.numPassedTests ?? report.numPassedTestSuites);
  const numFailed = Number(report.numFailedTests ?? 0);
  const numPending = Number(report.numPendingTests ?? 0);
  const numTodo = Number(report.numTodoTests ?? 0);
  const numSkipped = Number(
    report.numSkippedTests ?? report.skippedTests ?? Number.NaN,
  );

  // Prefer top-level Vitest counters when present and finite.
  let passed = Number.isFinite(numPassed) ? numPassed : null;
  let failed = Number.isFinite(numFailed) ? numFailed : null;
  let skipped = Number.isFinite(numSkipped)
    ? numSkipped
    : Number.isFinite(numPending) || Number.isFinite(numTodo)
      ? (Number.isFinite(numPending) ? numPending : 0) + (Number.isFinite(numTodo) ? numTodo : 0)
      : null;

  if (passed == null || failed == null || skipped == null) {
    const acc = { passed: 0, failed: 0, skipped: 0 };
    countByStatus(report.testResults ?? report, acc);
    passed = acc.passed;
    failed = acc.failed;
    skipped = acc.skipped;
  } else {
    // Still fold pending/todo into skipped when only those fields exist.
    if (!Number.isFinite(numSkipped) && (numPending > 0 || numTodo > 0)) {
      skipped = (numPending || 0) + (numTodo || 0);
    }
  }

  if (!Number.isFinite(minPassed) || minPassed < 1) {
    throw new Error(`${label}: --min-passed must be a positive integer`);
  }
  if (failed > 0) {
    throw new Error(`${label}: failed tests = ${failed} (must be 0)`);
  }
  if (skipped > 0) {
    throw new Error(`${label}: skipped/pending tests = ${skipped} (must be 0)`);
  }
  if (passed < minPassed) {
    throw new Error(`${label}: passed tests = ${passed} < required ${minPassed}`);
  }
  return { passed, failed, skipped, minPassed, label };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) die('usage: assert-vitest-no-skips.mjs <report.json> --min-passed=N');
  if (!Number.isFinite(args.minPassed) || args.minPassed < 1) {
    die('--min-passed must be a positive integer');
  }

  let raw;
  try {
    raw = readFileSync(args.file, 'utf8');
  } catch (err) {
    die(`cannot read ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    die(`invalid JSON in ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const result = assertVitestReport(report, {
      minPassed: args.minPassed,
      label: args.label,
    });
    console.log(
      `assert-vitest-no-skips: OK label=${result.label} passed=${result.passed} failed=${result.failed} skipped=${result.skipped} min=${result.minPassed}`,
    );
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('assert-vitest-no-skips.mjs');
if (isMain) main();
