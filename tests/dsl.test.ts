import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type { ArchitectureModel, RuleDefinition } from "../src/core/model.js";

const model: ArchitectureModel = {
  repositories: {
    consumer: {
      id: "consumer",
      type: "java",
      root: "/consumer",
      roles: ["consumer"]
    },
    catalog: {
      id: "catalog",
      type: "java",
      root: "/catalog",
      roles: ["catalog"]
    }
  },
  facts: [
    { kind: "usage", repositoryId: "consumer", name: "A", allowed: false },
    { kind: "catalog-item", repositoryId: "catalog", name: "A" }
  ]
};

test("a new project rule can be expressed without adding a TypeScript rule module", () => {
  const rule: RuleDefinition = {
    id: "CUSTOM001",
    description: "custom declarative rule",
    scope: "check",
    select: {
      fact: "usage",
      repositoryRoles: [{ field: "repositoryId", role: "consumer" }]
    },
    assert: [{
      field: "name",
      not: true,
      memberOf: {
        fact: "catalog-item",
        field: "name",
        repositoryRoles: [{ field: "repositoryId", role: "catalog" }]
      }
    }]
  };

  const violations = evaluateRules(model, [rule], "check");
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "CUSTOM001");
});
