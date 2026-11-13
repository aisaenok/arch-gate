import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  ResolvedJavaRepository,
  ResolvedOpenApiRepository,
  RuleDefinition
} from "../src/core/model.js";

function contract(id: string): ResolvedOpenApiRepository {
  return {
    id,
    type: "openapi",
    root: `/${id}`,
    roles: ["api-contract"],
    openapiFile: `/${id}/openapi.yaml`
  };
}

function backend(id: string): ResolvedJavaRepository {
  return {
    id,
    type: "java",
    root: `/${id}`,
    roles: ["api-provider"],
    sourceDirs: [`/${id}/src`],
    frameworks: ["jax-rs"]
  };
}

const rule: RuleDefinition = {
  id: "TOPO001",
  description: "contract operation is implemented by its related backend",
  scope: "check",
  select: {
    fact: "contract-operation",
    repositoryRoles: [
      { field: "repositoryId", role: "api-contract" }
    ]
  },
  assert: [
    {
      field: "operationKey",
      memberOf: {
        fact: "backend-endpoint",
        field: "operationKey",
        repositoryRoles: [
          { field: "repositoryId", role: "api-provider" }
        ],
        repositoryRelation: {
          type: "implemented-by",
          currentField: "repositoryId",
          candidateField: "repositoryId",
          direction: "outgoing"
        }
      }
    }
  ],
  sourceField: "repositoryId",
  targetField: "operationKey"
};

function evidence(repositoryId: string, factKind: string, status = "complete" as const) {
  return {
    repositoryId,
    producer: factKind === "contract-operation" ? "openapi" : "java",
    factKind,
    status
  };
}

test("relation-scoped memberOf rejects implementation in the wrong provider", () => {
  const model: ArchitectureModel = {
    repositories: {
      "orders-contract": contract("orders-contract"),
      "payments-contract": contract("payments-contract"),
      "orders-backend": backend("orders-backend"),
      "payments-backend": backend("payments-backend")
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
      },
      {
        kind: "backend-endpoint",
        repositoryId: "orders-backend",
        source: "OrdersResource.java:1:1",
        sourceFile: "OrdersResource.java",
        framework: "jax-rs",
        className: "OrdersResource",
        methodName: "getPayment",
        operationId: "",
        method: "GET",
        path: "/api/payments/{id}",
        operationKey: "GET /api/payments/{}"
      },
      {
        kind: "backend-endpoint",
        repositoryId: "payments-backend",
        source: "PaymentsResource.java:1:1",
        sourceFile: "PaymentsResource.java",
        framework: "jax-rs",
        className: "PaymentsResource",
        methodName: "getOrder",
        operationId: "",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      }
    ],
    evidence: [
      evidence("orders-contract", "contract-operation"),
      evidence("payments-contract", "contract-operation"),
      evidence("orders-backend", "backend-endpoint"),
      evidence("payments-backend", "backend-endpoint")
    ]
  };

  const result = evaluateRules(model, [rule], "check");

  assert.equal(result.status, "fail");
  assert.equal(result.violations.length, 2);
});

test("relation-scoped memberOf accepts the correct provider", () => {
  const model: ArchitectureModel = {
    repositories: {
      contracts: contract("contracts"),
      backend: backend("backend")
    },
    relations: [
      {
        type: "implemented-by",
        from: "contracts",
        to: "backend"
      }
    ],
    facts: [
      {
        kind: "contract-operation",
        repositoryId: "contracts",
        operationId: "getOrder",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      },
      {
        kind: "backend-endpoint",
        repositoryId: "backend",
        source: "OrdersResource.java:1:1",
        sourceFile: "OrdersResource.java",
        framework: "jax-rs",
        className: "OrdersResource",
        methodName: "getOrder",
        operationId: "",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      }
    ],
    evidence: [
      evidence("contracts", "contract-operation"),
      evidence("backend", "backend-endpoint")
    ]
  };

  const result = evaluateRules(model, [rule], "check");

  assert.equal(result.status, "pass");
});

test("missing evidence in the related provider produces PARTIAL", () => {
  const model: ArchitectureModel = {
    repositories: {
      contracts: contract("contracts"),
      backend: backend("backend"),
      "other-backend": backend("other-backend")
    },
    relations: [
      {
        type: "implemented-by",
        from: "contracts",
        to: "backend"
      }
    ],
    facts: [
      {
        kind: "contract-operation",
        repositoryId: "contracts",
        operationId: "getOrder",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      },
      {
        kind: "backend-endpoint",
        repositoryId: "other-backend",
        source: "OtherResource.java:1:1",
        sourceFile: "OtherResource.java",
        framework: "jax-rs",
        className: "OtherResource",
        methodName: "getOrder",
        operationId: "",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      }
    ],
    evidence: [
      evidence("contracts", "contract-operation"),
      {
        repositoryId: "backend",
        producer: "java",
        factKind: "backend-endpoint",
        status: "unavailable",
        message: "backend analysis unavailable"
      },
      evidence("other-backend", "backend-endpoint")
    ]
  };

  const result = evaluateRules(model, [rule], "check");

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.repositoryId, "backend");
});

test("missing topology relation produces PARTIAL instead of guessing", () => {
  const model: ArchitectureModel = {
    repositories: {
      contracts: contract("contracts"),
      backend: backend("backend")
    },
    relations: [],
    facts: [
      {
        kind: "contract-operation",
        repositoryId: "contracts",
        operationId: "getOrder",
        method: "GET",
        path: "/api/orders/{id}",
        operationKey: "GET /api/orders/{}"
      }
    ],
    evidence: [
      evidence("contracts", "contract-operation"),
      evidence("backend", "backend-endpoint")
    ]
  };

  const result = evaluateRules(model, [rule], "check");

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
});


test("plan operation is scoped to the contract related to its provider", () => {
  const planRule: RuleDefinition = {
    id: "PLAN_TOPO001",
    description: "planned operation belongs to provider contract",
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
          repositoryRoles: [
            { field: "repositoryId", role: "api-contract" }
          ],
          repositoryRelation: {
            type: "implemented-by",
            currentField: "providerRepositoryId",
            candidateField: "repositoryId",
            direction: "incoming"
          }
        }
      }
    ]
  };

  const model: ArchitectureModel = {
    repositories: {
      "orders-contract": contract("orders-contract"),
      "payments-contract": contract("payments-contract"),
      "orders-backend": backend("orders-backend"),
      "payments-backend": backend("payments-backend")
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
        providerRepositoryId: "payments-backend",
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
      evidence("orders-contract", "contract-operation"),
      evidence("payments-contract", "contract-operation")
    ]
  };

  const result = evaluateRules(model, [planRule], "plan");

  assert.equal(result.status, "fail");
  assert.equal(result.violations.length, 1);
});
