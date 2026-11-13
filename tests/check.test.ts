import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCheck } from "../src/engine.js";
import type {
  ResolvedGateConfig,
  ResolvedOpenApiRepository,
  ResolvedTypeScriptRepository
} from "../src/core/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");

function config(
  fixture: string,
  generatedRuntimeDirs: string[] = []
): ResolvedGateConfig {
  const consumerRoot = path.join(root, `fixtures/${fixture}`);
  const contractRoot = path.join(root, "fixtures/api-contracts");

  const consumer: ResolvedTypeScriptRepository = {
    id: "web-portal",
    type: "typescript",
    root: consumerRoot,
    roles: ["api-consumer"],
    sourceDir: path.join(consumerRoot, "src"),
    generatedRuntimeDirs: generatedRuntimeDirs.map((dir) => path.join(consumerRoot, dir)),
    allowDirectHttpDirs: [],
    allowManualContractTypeDirs: [],
    httpModules: ["axios"]
  };

  const contracts: ResolvedOpenApiRepository = {
    id: "contracts-core",
    type: "openapi",
    root: contractRoot,
    roles: ["api-contract"],
    openapiFile: path.join(contractRoot, "openapi.json")
  };

  return {
    configFile: "test",
    repositories: {
      "web-portal": consumer,
      "contracts-core": contracts,
      "service-a": {
        id: "service-a",
        type: "java",
        root: path.join(root, "fixtures/service-a"),
        roles: ["api-provider"]
      }
    },
    rules: {
      apiThroughGenerated: {
        consumerRole: "api-consumer",
        providerRole: "api-provider",
        contractRole: "api-contract"
      },
      wireTypesFromContract: {
        consumerRole: "api-consumer",
        contractRole: "api-contract"
      }
    }
  };
}

test("allows HTTP transport inside generated runtime directory", async () => {
  const violations = await runCheck(
    config("pl-valid", ["src/shared/api/generated"])
  );
  assert.deepEqual(violations, []);
});

test("rejects direct axios usage in a repository selected by role", async () => {
  const violations = await runCheck(config("pl-invalid-direct"));
  assert.equal(violations.some((violation) => violation.rule === "ARCH001"), true);
});

test("rejects manually declared wire DTO in a repository selected by role", async () => {
  const violations = await runCheck(config("pl-invalid-dto"));
  assert.equal(violations.some((violation) => violation.rule === "ARCH002"), true);
});
