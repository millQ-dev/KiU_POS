#!/usr/bin/env node
/**
 * Print a secrets-safe Vitest JSON summary (counts + failure messages).
 * Never prints env, URLs, or credentials.
 *
 * Usage: node scripts/ci/print-vitest-summary.mjs <report.json>
 */
import { readFileSync } from 'node:fs';

function redact(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/postgresql:\/\/[^\s'"`]+/gi, 'postgresql://[REDACTED]')
    .replace(/postgres:\/\/[^\s'"`]+/gi, 'postgres://[REDACTED]')
    .replace(/IDENTITY_PIN_PEPPER[^\n]*/gi, 'IDENTITY_PIN_PEPPER=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [REDACTED]')
    .replace(/cookie[=:][^\s;]+/gi, 'cookie=[REDACTED]');
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('print-vitest-summary: usage: <report.json>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(
      `print-vitest-summary: cannot parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const pending = report.numPendingTests ?? 0;
  const todo = report.numTodoTests ?? 0;
  const total = report.numTotalTests ?? passed + failed + pending + todo;
  console.log(
    `vitest-summary: total=${total} passed=${passed} failed=${failed} pending=${pending} todo=${todo} success=${report.success}`,
  );

  for (const suite of report.testResults ?? []) {
    const msg = suite.message ? redact(suite.message) : '';
    if (msg.trim()) {
      console.log(`suite-message: ${redact(suite.name || '')}`);
      console.log(msg);
    }
    for (const a of suite.assertionResults ?? []) {
      if (a.status === 'passed') continue;
      console.log(`assertion: status=${a.status} name=${redact(a.fullName || a.title || '')}`);
      for (const fm of a.failureMessages ?? []) {
        console.log(redact(fm));
      }
    }
  }
}

main();
