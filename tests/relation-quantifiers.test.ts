import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  ResolvedJavaRepository,
  ResolvedOpenApiRepository,
  RuleDefinition
} from "../src/core/model.js";

function contract(): ResolvedOpenApiRepository {
  return {
    id: "contracts",
    type: "openapi",
    root: "/contracts",
    roles: ["api-contract"],
    openapiFile: "/contracts/openapi.yaml"
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

function endpoint(repositoryId: string) {
  return {
    kind: "backend-endpoint",
    repositoryId,
    source: "Resource.java:1:1",
    sourceFile: "Resource.java",
    framework: "jax-rs",
    className: "Resource",
    methodName: "getOrder",
    operationId: "",
    method: "GET",
    path: "/api/orders/{id}",
    operationKey: "GET /api/orders/{}"
  };
}

function evidence(
  repositoryId: string,
  status: "complete" | "partial" | "unavailable"
) {
  return {
    repositoryId,
    producer: "java",
    factKind: "backend-endpoint",
    status
  };
}

function rule(
  quantifier: "any" | "all"
): RuleDefinition {
  return {
    id: "Q001",
    description: "relation quantifier",
    scope: "check",
    select: { fact: "contract-operation" },
    assert: [
      {
        field: "operationKey",
        memberOf: {
          fact: "backend-endpoint",
          field: "operationKey",
          repositoryRelation: {
            type: "implemented-by",
            currentField: "repositoryId",
            candidateField: "repositoryId",
            direction: "outgoing",
            quantifier
          }
        }
      }
    ]
  };
}

function model(
  facts: ArchitectureModel["facts"],
  evidenceFacts: ArchitectureModel["evidence"]
): ArchitectureModel {
  return {
    repositories: {
      contracts: contract(),
      primary: backend("primary"),
      replica: backend("replica")
    },
    relations: [
      {
        type: "implemented-by",
        from: "contracts",
        to: "primary"
      },
      {
        type: "implemented-by",
        from: "contracts",
        to: "replica"
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
      ...facts
    ],
    evidence: [
      {
        repositoryId: "contracts",
        producer: "openapi",
        factKind: "contract-operation",
        status: "complete"
      },
      ...evidenceFacts
    ]
  };
}

test("ANY passes when one related repository proves the match", () => {
  const result = evaluateRules(
    model(
      [endpoint("primary")],
      [
        evidence("primary", "complete"),
        evidence("replica", "unavailable")
      ]
    ),
    [rule("any")],
    "check"
  );

  assert.equal(result.status, "pass");
  assert.equal(result.gaps.length, 0);
});

test("ANY is PARTIAL when no match exists and one related repository is unknown", () => {
  const result = evaluateRules(
    model(
      [],
      [
        evidence("primary", "complete"),
        evidence("replica", "unavailable")
      ]
    ),
    [rule("any")],
    "check"
  );

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.repositoryId, "replica");
});

test("ANY fails when all related evidence is complete and no repository matches", () => {
  const result = evaluateRules(
    model(
      [],
      [
        evidence("primary", "complete"),
        evidence("replica", "complete")
      ]
    ),
    [rule("any")],
    "check"
  );

  assert.equal(result.status, "fail");
});

test("ALL fails when one related repository is completely known to be missing the match", () => {
  const result = evaluateRules(
    model(
      [endpoint("primary")],
      [
        evidence("primary", "complete"),
        evidence("replica", "complete")
      ]
    ),
    [rule("all")],
    "check"
  );

  assert.equal(result.status, "fail");
  assert.equal(
    result.violations[0]?.details?.missingRepositories,
    "replica"
  );
});

test("ALL is PARTIAL when the only missing match is in an incompletely analyzed repository", () => {
  const result = evaluateRules(
    model(
      [endpoint("primary")],
      [
        evidence("primary", "complete"),
        evidence("replica", "partial")
      ]
    ),
    [rule("all")],
    "check"
  );

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps[0]?.repositoryId, "replica");
});

test("ALL passes only when every related repository proves the match", () => {
  const result = evaluateRules(
    model(
      [
        endpoint("primary"),
        endpoint("replica")
      ],
      [
        evidence("primary", "complete"),
        evidence("replica", "complete")
      ]
    ),
    [rule("all")],
    "check"
  );

  assert.equal(result.status, "pass");
});
