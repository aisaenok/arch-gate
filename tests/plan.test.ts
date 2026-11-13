import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildArchitectureModel } from "../src/engine.js";
import { checkPlan } from "../src/plan.js";
import type { ResolvedGateConfig } from "../src/core/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");
const contractRoot = path.join(root, "fixtures/api-contracts");

const config: ResolvedGateConfig = {
  configFile: "test",
  repositories: {
    frontend: {
      id: "frontend",
      type: "typescript",
      root: path.join(root, "fixtures/pl-valid"),
      roles: ["api-consumer"],
      sourceDir: path.join(root, "fixtures/pl-valid/src"),
      generatedRuntimeDirs: [path.join(root, "fixtures/pl-valid/src/shared/api/generated")],
      allowDirectHttpDirs: [],
      allowManualContractTypeDirs: [],
      httpModules: ["axios"]
    },
    contracts: {
      id: "contracts",
      type: "openapi",
      root: contractRoot,
      roles: ["api-contract"],
      openapiFile: path.join(contractRoot, "openapi.json")
    },
    backend: {
      id: "backend",
      type: "java",
      root: path.join(root, "fixtures/backend"),
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

test("accepts contract-first implementation intent using repository ids from config", async () => {
  const model = await buildArchitectureModel(config, { analyzeTypeScript: false });
  const violations = checkPlan({
    apiCalls: [{
      consumer: "frontend",
      provider: "backend",
      operationId: "getApplication",
      via: "generated-runtime"
    }],
    wireTypes: [{
      consumer: "frontend",
      name: "ApplicationResponse",
      source: "contracts"
    }]
  }, model, config);

  assert.deepEqual(violations, []);
});

test("rejects custom transport and non-contract DTO source without hardcoded repo names", async () => {
  const model = await buildArchitectureModel(config, { analyzeTypeScript: false });
  const violations = checkPlan({
    apiCalls: [{
      consumer: "frontend",
      provider: "backend",
      operationId: "getApplication",
      via: "custom-http"
    }],
    wireTypes: [{
      consumer: "frontend",
      name: "ApplicationResponse",
      source: "frontend"
    }]
  }, model, config);

  assert.deepEqual(
    new Set(violations.map((violation) => violation.rule)),
    new Set(["PLAN002", "PLAN004"])
  );
});
