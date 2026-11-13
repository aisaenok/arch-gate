import assert from "node:assert/strict";
import test from "node:test";
import {
  assertKnownFactKind
} from "../src/core/facts.js";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  RuleDefinition
} from "../src/core/model.js";

test("unknown fact kinds are rejected instead of passing vacuously", () => {
  assert.throws(
    () =>
      assertKnownFactKind(
        "http-usgae",
        "test"
      ),
    /unknown fact kind/
  );
});

test("unavailable analyzer evidence produces PARTIAL", () => {
  const model: ArchitectureModel = {
    repositories: {
      backend: {
        id: "backend",
        type: "java",
        root: "/backend",
        roles: ["api-provider"],
        sourceDirs: ["/backend"],
        frameworks: ["jax-rs"]
      }
    },
    facts: [],
    evidence: [
      {
        repositoryId: "backend",
        producer: "java",
        factKind: "backend-endpoint",
        status: "unavailable",
        message: "not implemented"
      }
    ]
  };

  const rules: RuleDefinition[] = [
    {
      id: "API003",
      description: "backend endpoints are contract-backed",
      scope: "check",
      select: {
        fact: "backend-endpoint",
        repositoryRoles: [
          {
            field: "repositoryId",
            role: "api-provider"
          }
        ]
      },
      assert: [
        {
          field: "operationId",
          equals: "anything"
        }
      ]
    }
  ];

  const result = evaluateRules(model, rules, "check");
  assert.equal(result.status, "partial");
  assert.equal(result.gaps.length, 1);
});

test("complete evidence with zero facts is a real PASS", () => {
  const model: ArchitectureModel = {
    repositories: {
      frontend: {
        id: "frontend",
        type: "typescript",
        root: "/frontend",
        roles: ["api-consumer"],
        sourceDir: "/frontend/src",
        generatedRuntimeDirs: [],
        allowDirectHttpDirs: [],
        allowManualContractTypeDirs: [],
        httpModules: ["axios"]
      }
    },
    facts: [],
    evidence: [
      {
        repositoryId: "frontend",
        producer: "typescript",
        factKind: "http-call",
        status: "complete"
      }
    ]
  };

  const result = evaluateRules(
    model,
    [
      {
        id: "NOHTTP",
        description: "no calls",
        scope: "check",
        select: {
          fact: "http-call",
          repositoryRoles: [
            {
              field: "repositoryId",
              role: "api-consumer"
            }
          ]
        },
        assert: [
          {
            field: "sourceGenerated",
            equals: false
          }
        ]
      }
    ],
    "check"
  );

  assert.equal(result.status, "pass");
});
