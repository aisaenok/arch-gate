import type {
  EvaluationResult,
  OutputFormat
} from "./core/model.js";

export function report(
  result: EvaluationResult,
  format: OutputFormat
): void {
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: result.status === "pass",
          status: result.status,
          violations: result.violations,
          gaps: result.gaps
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (result.status === "pass") {
    console.log("Architecture Gate: PASS");
    return;
  }

  if (result.status === "fail") {
    console.error(
      `Architecture Gate: FAIL (${result.violations.length} violation${result.violations.length === 1 ? "" : "s"})`
    );
  } else {
    console.error(
      `Architecture Gate: PARTIAL (${result.gaps.length} evidence gap${result.gaps.length === 1 ? "" : "s"})`
    );
  }

  for (const violation of result.violations) {
    console.error(`\n${violation.rule}: ${violation.message}`);
    if (violation.source) {
      console.error(`Source: ${violation.source}`);
    }
    if (violation.target) {
      console.error(`Target: ${violation.target}`);
    }
    for (const [key, value] of Object.entries(
      violation.details ?? {}
    )) {
      console.error(`${key}: ${value}`);
    }
  }

  if (result.gaps.length > 0) {
    console.error("\nEvidence gaps:");
    for (const gap of result.gaps) {
      const repository = gap.repositoryId
        ? ` [${gap.repositoryId}]`
        : "";
      console.error(
        `- ${gap.rule}: ${gap.fact}${repository}: ${gap.message}`
      );
    }
  }
}
