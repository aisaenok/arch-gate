#!/usr/bin/env node
import path from "node:path";
import { loadConfig } from "./config.js";
import { loadContractCatalog } from "./openapi.js";
import { analyzePl } from "./pl.js";
import { checkPlan, loadIntent } from "./plan.js";
import { report } from "./report.js";
import type { OutputFormat } from "./model.js";

interface CliOptions {
  command: "check" | "plan";
  configFile: string;
  intentFile?: string;
  format: OutputFormat;
}

function usage(): never {
  console.error(`Usage:\n  arch-gate check --config <file> [--format text|json]\n  arch-gate plan <intent.json> --config <file> [--format text|json]`);
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "plan") usage();

  let configFile: string | undefined;
  let intentFile: string | undefined;
  let format: OutputFormat = "text";

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--config") configFile = rest[++i];
    else if (arg === "--format") {
      const value = rest[++i];
      if (value !== "text" && value !== "json") usage();
      format = value;
    } else if (command === "plan" && !arg.startsWith("-") && !intentFile) {
      intentFile = arg;
    } else usage();
  }

  if (!configFile || (command === "plan" && !intentFile)) usage();
  return { command, configFile, intentFile, format };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options.configFile);
  const contracts = await loadContractCatalog(config.contractsFile);

  const violations = options.command === "check"
    ? await analyzePl(config.pl, contracts)
    : checkPlan(await loadIntent(path.resolve(options.intentFile!)), contracts);

  report(violations, options.format);
  process.exitCode = violations.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Architecture Gate error: ${message}`);
  process.exitCode = 2;
});
