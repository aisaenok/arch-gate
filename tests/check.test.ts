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
        generatedRuntimeDirs: generatedRuntimeDirs.map((dir) =>
          path.join(consumerRoot, dir)
        ),
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
        description: "consumer HTTP must go through generated runtime",
        scope: "check",
        select: {
          fact: "http-reach",
          repositoryRoles: [
            { field: "repositoryId", role: "api-consumer" }
          ],
          where: [
            {
              field: "sourceDirectHttpAllowed",
              equals: false
            }
          ]
        },
        assert: [
          {
            field: "throughGeneratedRuntime",
            equals: true
          }
        ],
        sourceField: "sourceFile"
      }
    ]
  };
}

test("allows HTTP reached through generated runtime", async () => {
  const result = await runCheck(
    config("pl-valid", ["src/shared/api/generated"])
  );
  assert.equal(result.status, "pass");
  assert.deepEqual(result.violations, []);
});

test("rejects direct axios call outside generated runtime", async () => {
  const result = await runCheck(config("pl-invalid-direct"));
  assert.equal(
    result.violations.some(
      (violation) => violation.rule === "API001"
    ),
    true
  );
});
