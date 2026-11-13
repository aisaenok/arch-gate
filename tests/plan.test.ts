import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadContractCatalog } from "../src/openapi.js";
import { checkPlan } from "../src/plan.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");
const contractsFile = path.join(root, "fixtures/api-contracts/openapi.json");

test("accepts contract-first implementation intent", async () => {
  const contracts = await loadContractCatalog(contractsFile);
  const violations = checkPlan({
    apiCalls: [{ consumer: "pl", provider: "bh", operationId: "getApplication", via: "generated-runtime" }],
    wireTypes: [{ consumer: "pl", name: "ApplicationResponse", source: "api-contracts" }]
  }, contracts);
  assert.deepEqual(violations, []);
});

test("rejects custom transport and manual wire DTO source", async () => {
  const contracts = await loadContractCatalog(contractsFile);
  const violations = checkPlan({
    apiCalls: [{ consumer: "pl", provider: "bh", operationId: "getApplication", via: "custom-http" }],
    wireTypes: [{ consumer: "pl", name: "ApplicationResponse", source: "pl" }]
  }, contracts);
  assert.deepEqual(new Set(violations.map((violation) => violation.rule)), new Set(["PLAN002", "PLAN004"]));
});
