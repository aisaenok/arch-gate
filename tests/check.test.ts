import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCheck } from "../src/engine.js";
import type { ResolvedGateConfig } from "../src/core/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");

function config(
  fixture: string,
  generatedRuntimeDirs: string[] = []
): ResolvedGateConfig {
  const consumerRoot = path.join(root, `fixtures/${fixture}`);
  const contractRoot = path.join(root, "fixtures/api-contracts");

  return {
    configFile: "test",
    repositories: {
      "web-portal": {
        id: "web-portal",
        type: "typescript",
        root: consumerRoot,
        roles: ["api-consumer"],
        sourceDir: path.join(consumerRoot, "src"),
        generatedRuntimeDirs: generatedRuntimeDirs.map((dir) => path.join(consumerRoot, dir)),
        allowDirectHttpDirs: [],
        allowManualContractTypeDirs: [],
        httpModules: ["axios"]
      },
      "contracts-core": {
        id: "contracts-core",
        type: "openapi",
        root: contractRoot,
        roles: ["api-contract"],
        openapiFile: path.join(contractRoot, "openapi.json")
      }
    },
    rules: [
      {
        id: "API001",
        description: "consumer HTTP must be allowed",
        scope: "check",
        select: {
          fact: "http-usage",
          repositoryRoles: [{ field: "repositoryId", role: "api-consumer" }]
        },
        assert: [{ field: "directHttpAllowed", equals: true }],
        sourceField: "source"
      },
      {
        id: "API002",
        description: "consumer must not recreate contract schemas",
        scope: "check",
        select: {
          fact: "declared-type",
          repositoryRoles: [{ field: "repositoryId", role: "api-consumer" }],
          where: [{ field: "manualContractTypeAllowed", equals: false }]
        },
        assert: [{
          field: "name",
          not: true,
          memberOf: {
            fact: "contract-schema",
            field: "name",
            repositoryRoles: [{ field: "repositoryId", role: "api-contract" }]
          }
        }]
      }
    ]
  };
}

test("allows HTTP transport inside generated runtime directory", async () => {
  assert.deepEqual(
    await runCheck(config("pl-valid", ["src/shared/api/generated"])),
    []
  );
});

test("rejects direct axios usage using only declarative rule config", async () => {
  const violations = await runCheck(config("pl-invalid-direct"));
  assert.equal(violations.some((violation) => violation.rule === "API001"), true);
});

test("rejects manual wire DTO using memberOf relation from declarative rule", async () => {
  const violations = await runCheck(config("pl-invalid-dto"));
  assert.equal(violations.some((violation) => violation.rule === "API002"), true);
});
