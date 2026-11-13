import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeJavaRepository } from "../src/analyzers/java.js";
import { analyzeOpenApiRepository } from "../src/analyzers/openapi.js";
import { evaluateRules } from "../src/core/engine.js";
import type {
  ArchitectureModel,
  ResolvedJavaRepository,
  ResolvedOpenApiRepository,
  RuleDefinition
} from "../src/core/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");

function javaRepository(fixture: string): ResolvedJavaRepository {
  const repositoryRoot = path.join(root, `fixtures/${fixture}`);
  return {
    id: "backend",
    type: "java",
    root: repositoryRoot,
    roles: ["api-provider"],
    sourceDirs: [path.join(repositoryRoot, "src/main/java")],
    frameworks: ["jax-rs"]
  };
}

const contractRoot = path.join(root, "fixtures/api-contracts");
const contractRepository: ResolvedOpenApiRepository = {
  id: "contracts",
  type: "openapi",
  root: contractRoot,
  roles: ["api-contract"],
  openapiFile: path.join(contractRoot, "openapi.json")
};

const rule: RuleDefinition = {
  id: "BACKEND001",
  description: "backend endpoint exists in contract",
  scope: "check",
  select: {
    fact: "backend-endpoint",
    repositoryRoles: [
      { field: "repositoryId", role: "api-provider" }
    ]
  },
  assert: [
    {
      field: "operationKey",
      memberOf: {
        fact: "contract-operation",
        field: "operationKey",
        repositoryRoles: [
          { field: "repositoryId", role: "api-contract" }
        ]
      }
    }
  ],
  sourceField: "source",
  targetField: "operationKey"
};

test("extracts JAX-RS class + method path into normalized endpoint fact", async () => {
  const analysis = await analyzeJavaRepository(
    javaRepository("bh-jaxrs")
  );

  assert.equal(analysis.evidence[0]?.status, "complete");
  assert.equal(analysis.facts.length, 1);
  assert.equal(
    analysis.facts[0]?.operationKey,
    "GET /applications/{}"
  );
});

test("backend endpoint declared in OpenAPI passes", async () => {
  const java = await analyzeJavaRepository(
    javaRepository("bh-jaxrs")
  );
  const contract = await analyzeOpenApiRepository(
    contractRepository
  );

  const model: ArchitectureModel = {
    relations: [],
    repositories: {
      backend: javaRepository("bh-jaxrs"),
      contracts: contractRepository
    },
    facts: [...java.facts, ...contract.facts],
    evidence: [...java.evidence, ...contract.evidence]
  };

  const result = evaluateRules(model, [rule], "check");
  assert.equal(result.status, "pass");
});

test("backend endpoint absent from OpenAPI fails", async () => {
  const java = await analyzeJavaRepository(
    javaRepository("bh-jaxrs-invalid")
  );
  const contract = await analyzeOpenApiRepository(
    contractRepository
  );

  const model: ArchitectureModel = {
    relations: [],
    repositories: {
      backend: javaRepository("bh-jaxrs-invalid"),
      contracts: contractRepository
    },
    facts: [...java.facts, ...contract.facts],
    evidence: [...java.evidence, ...contract.evidence]
  };

  const result = evaluateRules(model, [rule], "check");
  assert.equal(result.status, "fail");
  assert.equal(result.violations[0]?.target, "GET /admin");
});
