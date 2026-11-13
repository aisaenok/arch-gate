import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  ResolvedJavaRepository,
  ResolvedOpenApiRepository,
  RuleDefinition
} from "../src/core/model.js";

function javaRepo(id: string): ResolvedJavaRepository {
  return {
    id,
    type: "java",
    root: `/${id}`,
    roles: ["api-provider"],
    sourceDirs: [`/${id}/src`],
    frameworks: []
  };
}

function contract(id: string): ResolvedOpenApiRepository {
  return {
    id,
    type: "openapi",
    root: `/${id}`,
    roles: ["api-contract"],
    openapiFile: `/${id}/openapi.yaml`
  };
}

const rule: RuleDefinition = {
  id: "PATH001",
  description: "planned operation belongs to contract behind provider chain",
  scope: "plan",
  select: {
    fact: "intent-api-call"
  },
  assert: [
    {
      field: "operationId",
      memberOf: {
        fact: "contract-operation",
        field: "operationId",
        repositoryRelation: {
          currentField: "providerRepositoryId",
          candidateField: "repositoryId",
          path: [
            {
              type: "forwards-to",
              direction: "outgoing"
            },
            {
              type: "implemented-by",
              direction: "incoming"
            }
          ],
          quantifier: "any"
        }
      }
    }
  ]
};

function baseModel(): ArchitectureModel {
  return {
    repositories: {
      bff: javaRepo("bff"),
      "orders-backend": javaRepo("orders-backend"),
      "payments-backend": javaRepo("payments-backend"),
      "orders-contract": contract("orders-contract"),
      "payments-contract": contract("payments-contract")
    },
    relations: [
      {
        type: "implemented-by",
        from: "orders-contract",
        to: "orders-backend"
      },
      {
        type: "implemented-by",
        from: "payments-contract",
        to: "payments-backend"
      }
    ],
    facts: [
      {
        kind: "intent-api-call",
        consumerRepositoryId: "frontend",
        providerRepositoryId: "bff",
        operationId: "getOrder",
        via: "generated-runtime"
      },
      {
        kind: "contract-operation",
        repositoryId: "orders-contract",
        operationId: "getOrder",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      },
      {
        kind: "contract-operation",
        repositoryId: "payments-contract",
        operationId: "getPayment",
        method: "GET",
        path: "/api/payments/{id}",
        operationKey: "GET /api/payments/{}"
      }
    ],
    evidence: [
      {
        repositoryId: "@intent",
        producer: "intent",
        factKind: "intent-api-call",
        status: "complete"
      },
      {
        repositoryId: "orders-contract",
        producer: "openapi",
        factKind: "contract-operation",
        status: "complete"
      },
      {
        repositoryId: "payments-contract",
        producer: "openapi",
        factKind: "contract-operation",
        status: "complete"
      }
    ]
  };
}

test("explicit relation path accepts a valid provider chain", () => {
  const model = baseModel();
  model.relations.push({
    type: "forwards-to",
    from: "bff",
    to: "orders-backend"
  });

  const result = evaluateRules(model, [rule], "plan");

  assert.equal(result.status, "pass");
});

test("explicit relation path rejects operation from another terminal contract", () => {
  const model = baseModel();
  model.relations.push({
    type: "forwards-to",
    from: "bff",
    to: "payments-backend"
  });

  const result = evaluateRules(model, [rule], "plan");

  assert.equal(result.status, "fail");
  assert.equal(result.violations.length, 1);
  assert.equal(
    result.violations[0]?.details?.relatedRepositories,
    "payments-contract"
  );
});

test("broken intermediate topology path produces PARTIAL", () => {
  const model = baseModel();

  const result = evaluateRules(model, [rule], "plan");

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps.length, 1);
});
