import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  RuleDefinition
} from "../src/core/model.js";

function model(
  targetStatus: "complete" | "partial" | "unavailable",
  includeMatch: boolean
): ArchitectureModel {
  return {
    relations: [],
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
        name: "A"
      },
      ...(includeMatch
        ? [
            {
              kind: "catalog-item",
              repositoryId: "catalog",
              name: "A"
            }
          ]
        : [])
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
        status: targetStatus,
        message:
          targetStatus === "complete"
            ? undefined
            : "catalog analysis incomplete"
      }
    ]
  };
}

function rule(not = false): RuleDefinition {
  return {
    id: "MEMBER001",
    description: "usage must exist in catalog",
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
        not,
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
}

test("memberOf with no match and partial target evidence is PARTIAL", () => {
  const result = evaluateRules(
    model("partial", false),
    [rule()],
    "check"
  );

  assert.equal(result.status, "partial");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.repositoryId, "catalog");
});

test("memberOf with a proven match passes despite partial target evidence", () => {
  const result = evaluateRules(
    model("partial", true),
    [rule()],
    "check"
  );

  assert.equal(result.status, "pass");
  assert.equal(result.violations.length, 0);
  assert.equal(result.gaps.length, 0);
});

test("memberOf with no match and complete target evidence fails", () => {
  const result = evaluateRules(
    model("complete", false),
    [rule()],
    "check"
  );

  assert.equal(result.status, "fail");
  assert.equal(result.violations.length, 1);
});

test("negated memberOf needs complete evidence to prove absence", () => {
  const partial = evaluateRules(
    model("unavailable", false),
    [rule(true)],
    "check"
  );
  assert.equal(partial.status, "partial");
  assert.equal(partial.violations.length, 0);

  const complete = evaluateRules(
    model("complete", false),
    [rule(true)],
    "check"
  );
  assert.equal(complete.status, "pass");
});

test("negated memberOf fails immediately when prohibited match exists", () => {
  const result = evaluateRules(
    model("partial", true),
    [rule(true)],
    "check"
  );

  assert.equal(result.status, "fail");
  assert.equal(result.violations.length, 1);
});
