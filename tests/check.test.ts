import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadContractCatalog } from "../src/openapi.js";
import { analyzePl } from "../src/pl.js";
import type { ResolvedPlConfig } from "../src/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");
const contractsFile = path.join(root, "fixtures/api-contracts/openapi.json");

function config(fixture: string, generatedRuntimeDirs: string[] = []): ResolvedPlConfig {
  const plRoot = path.join(root, `fixtures/${fixture}`);
  return {
    root: plRoot,
    sourceDir: path.join(plRoot, "src"),
    generatedRuntimeDirs: generatedRuntimeDirs.map((dir) => path.join(plRoot, dir)),
    allowDirectHttpDirs: [],
    allowManualContractTypeDirs: [],
    httpModules: ["axios"]
  };
}

test("allows HTTP transport inside generated runtime directory", async () => {
  const contracts = await loadContractCatalog(contractsFile);
  const violations = await analyzePl(config("pl-valid", ["src/shared/api/generated"]), contracts);
  assert.deepEqual(violations, []);
});

test("rejects direct axios usage outside generated runtime", async () => {
  const contracts = await loadContractCatalog(contractsFile);
  const violations = await analyzePl(config("pl-invalid-direct"), contracts);
  assert.equal(violations.some((violation) => violation.rule === "ARCH001"), true);
});

test("rejects manually declared wire DTO with contract schema name", async () => {
  const contracts = await loadContractCatalog(contractsFile);
  const violations = await analyzePl(config("pl-invalid-dto"), contracts);
  assert.equal(violations.some((violation) => violation.rule === "ARCH002"), true);
});
