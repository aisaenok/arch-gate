import type { OutputFormat, Violation } from "./core/model.js";

export function report(violations: Violation[], format: OutputFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`);
    return;
  }

  if (violations.length === 0) {
    console.log("Architecture Gate: PASS");
    return;
  }

  console.error(`Architecture Gate: FAIL (${violations.length} violation${violations.length === 1 ? "" : "s"})`);

  for (const violation of violations) {
    console.error(`\n${violation.rule}: ${violation.message}`);
    if (violation.source) console.error(`Source: ${violation.source}`);
    if (violation.target) console.error(`Target: ${violation.target}`);
    for (const [key, value] of Object.entries(violation.details ?? {})) {
      console.error(`${key}: ${value}`);
    }
  }
}
