import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  RuleDefinition
} from "../src/core/model.js";

const model: ArchitectureModel = {
  repositories: {
    consumer: {
      id: "consumer",
      type: "java",
      root: "/consumer",
      roles: ["consumer"],
      sourceDirs: ["/consumer"],
      frameworks: []
    },
    catalog: {
      id: "catalog",
      type: "java",
      root: "/catalog",
      roles: ["catalog"],
      sourceDirs: ["/catalog"],
      frameworks: []
    }
  },
  facts: [
    {
      kind: "usage",
      repositoryId: "consumer",
      name: "A",
      allowed: false
    },
    {
      kind: "catalog-item",
      repositoryId: "catalog",
      name: "A"
    }
  ],
  evidence: [
    {
      repositoryId: "consumer",
      producer: "test",
      factKind: "usage",
      status: "complete"
    },
    {
      repositoryId: "catalog",
      producer: "test",
      factKind: "catalog-item",
      status: "complete"
    }
  ]
};

test("generic engine can evaluate arbitrary in-memory facts", () => {
  const rule: RuleDefinition = {
    id: "CUSTOM001",
    description: "custom declarative rule",
    scope: "check",
    select: {
      fact: "usage",
      repositoryRoles: [
        { field: "repositoryId", role: "consumer" }
      ]
    },
    assert: [
      {
        field: "name",
        not: true,
        memberOf: {
          fact: "catalog-item",
          field: "name",
          repositoryRoles: [
            { field: "repositoryId", role: "catalog" }
          ]
        }
      }
    ]
  };

  const result = evaluateRules(model, [rule], "check");
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.rule, "CUSTOM001");
});
