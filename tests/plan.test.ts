import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runPlan } from "../src/engine.js";
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
      generatedRuntimeDirs: [],
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
  rules: [
    {
      id: "PLAN001",
      description: "operation exists",
      scope: "plan",
      select: {
        fact: "intent-api-call",
        repositoryRoles: [
          {
            field: "consumerRepositoryId",
            role: "api-consumer"
          },
          {
            field: "providerRepositoryId",
            role: "api-provider"
          }
        ]
      },
      assert: [
        {
          field: "operationId",
          memberOf: {
            fact: "contract-operation",
            field: "operationId",
            repositoryRoles: [
              {
                field: "repositoryId",
                role: "api-contract"
              }
            ]
          }
        }
      ]
    },
    {
      id: "PLAN002",
      description: "generated runtime",
      scope: "plan",
      select: { fact: "intent-api-call" },
      assert: [
        {
          field: "via",
          equals: "generated-runtime"
        }
      ]
    },
    {
      id: "PLAN003",
      description: "wire schema exists in source repository",
      scope: "plan",
      select: { fact: "intent-wire-type" },
      assert: [
        {
          field: "name",
          memberOf: {
            fact: "contract-schema",
            field: "name",
            repositoryMatch: {
              sourceField: "repositoryId",
              currentField: "sourceRepositoryId"
            }
          }
        }
      ]
    },
    {
      id: "PLAN004",
      description: "wire source is contract",
      scope: "plan",
      select: { fact: "intent-wire-type" },
      assert: [
        {
          field: "sourceRepositoryId",
          hasRole: "api-contract"
        }
      ]
    }
  ]
};

test("accepts contract-first implementation intent", async () => {
  const result = await runPlan(config, {
    apiCalls: [
      {
        consumer: "frontend",
        provider: "backend",
        operationId: "getApplication",
        via: "generated-runtime"
      }
    ],
    wireTypes: [
      {
        consumer: "frontend",
        name: "ApplicationResponse",
        source: "contracts"
      }
    ]
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.violations, []);
});

test("rejects invalid implementation intent", async () => {
  const result = await runPlan(config, {
    apiCalls: [
      {
        consumer: "frontend",
        provider: "backend",
        operationId: "getApplication",
        via: "custom-http"
      }
    ],
    wireTypes: [
      {
        consumer: "frontend",
        name: "ApplicationResponse",
        source: "frontend"
      }
    ]
  });

  assert.deepEqual(
    new Set(result.violations.map((violation) => violation.rule)),
    new Set(["PLAN002", "PLAN003", "PLAN004"])
  );
});
