import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import {
  create,
  toBinary
} from "@bufbuild/protobuf";
import {
  IndexSchema,
  SymbolRole
} from "@scip-code/scip";
import { analyzeJavaRepository } from "../src/analyzers/java.js";
import { analyzeOpenApiRepository } from "../src/analyzers/openapi.js";
import { evaluateRules } from "../src/core/engine.js";
import {
  parseScipIndex
} from "../src/scip/index.js";
import {
  ScipWorkspace
} from "../src/scip/workspace.js";
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


test("annotated JAX-RS interface without SCIP produces partial evidence", async () => {
  const analysis = await analyzeJavaRepository(
    javaRepository("bh-jaxrs-interface-only")
  );

  assert.equal(analysis.evidence[0]?.status, "partial");
  assert.match(
    analysis.evidence[0]?.message ?? "",
    /SCIP index is required/
  );
  assert.equal(analysis.facts.length, 0);
});

test("interface implementation is not guessed without SCIP", async () => {
  const analysis = await analyzeJavaRepository(
    javaRepository("bh-jaxrs-inherited")
  );

  assert.equal(analysis.evidence[0]?.status, "partial");
  assert.match(
    analysis.evidence[0]?.message ?? "",
    /SCIP index is required/
  );
  assert.equal(analysis.facts.length, 0);
});


test("interface overload analysis without SCIP remains partial", async () => {
  const analysis = await analyzeJavaRepository(
    javaRepository("bh-jaxrs-inherited-wrong-overload")
  );

  assert.equal(analysis.evidence[0]?.status, "partial");
  assert.equal(analysis.facts.length, 0);
});


test("missing configured Java sourceDir makes endpoint evidence partial", async () => {
  const repository = javaRepository("bh-jaxrs");
  repository.sourceDirs.push(
    path.join(repository.root, "target/generated-sources/missing")
  );

  const analysis = await analyzeJavaRepository(repository);

  assert.equal(analysis.facts.length, 1);
  assert.equal(analysis.evidence[0]?.status, "partial");
  assert.match(
    analysis.evidence[0]?.message ?? "",
    /configured Java sourceDir is unavailable/
  );
});


test("JAX-RS metadata is inherited from an interface in another SCIP repository", async (t) => {
  const parent = await mkdtemp(
    path.join(
      os.tmpdir(),
      "arch-gate-java-scip-federation-"
    )
  );

  t.after(async () => {
    await rm(parent, {
      recursive: true,
      force: true
    });
  });

  const apiRoot = path.join(parent, "api");
  const backendRoot = path.join(parent, "backend");
  const apiSource = path.join(
    apiRoot,
    "src/main/java/dev/example"
  );
  const backendSource = path.join(
    backendRoot,
    "src/main/java/dev/example"
  );

  await Promise.all([
    mkdir(apiSource, { recursive: true }),
    mkdir(backendSource, { recursive: true })
  ]);

  const interfaceSource = [
    "package dev.example;",
    "",
    "import jakarta.ws.rs.GET;",
    "import jakarta.ws.rs.Path;",
    "",
    '@Path("/applications")',
    "public interface ApplicationApi {",
    '  @GET @Path("/{id}")',
    "  String get();",
    "}",
    ""
  ].join("\n");

  const implementationSource = [
    "package dev.example;",
    "",
    "public class ApplicationController implements ApplicationApi {",
    "  public String get() {",
    '    return "ok";',
    "  }",
    "}",
    ""
  ].join("\n");

  const apiFile =
    "src/main/java/dev/example/ApplicationApi.java";
  const backendFile =
    "src/main/java/dev/example/ApplicationController.java";

  await Promise.all([
    writeFile(
      path.join(apiRoot, apiFile),
      interfaceSource,
      "utf8"
    ),
    writeFile(
      path.join(backendRoot, backendFile),
      implementationSource,
      "utf8"
    )
  ]);

  const interfaceSymbol =
    "scip-java maven api 1.0.0 dev/example/ApplicationApi#get().";
  const implementationSymbol =
    "scip-java maven backend 1.0.0 dev/example/ApplicationController#get().";

  const apiIndex = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath: apiFile,
            symbols: [
              {
                symbol: interfaceSymbol,
                displayName: "get"
              }
            ],
            occurrences: [
              {
                range: [8, 9, 12],
                symbol: interfaceSymbol,
                symbolRoles: SymbolRole.Definition
              }
            ]
          }
        ]
      })
    )
  );

  const backendIndex = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath: backendFile,
            symbols: [
              {
                symbol: implementationSymbol,
                displayName: "get",
                relationships: [
                  {
                    symbol: interfaceSymbol,
                    isImplementation: true
                  }
                ]
              }
            ],
            occurrences: [
              {
                range: [3, 16, 19],
                symbol: implementationSymbol,
                symbolRoles: SymbolRole.Definition
              }
            ]
          }
        ]
      })
    )
  );

  const workspace = new ScipWorkspace([
    {
      repositoryId: "api",
      repositoryRoot: apiRoot,
      index: apiIndex
    },
    {
      repositoryId: "backend",
      repositoryRoot: backendRoot,
      index: backendIndex
    }
  ]);

  const repository: ResolvedJavaRepository = {
    id: "backend",
    type: "java",
    root: backendRoot,
    roles: ["api-provider"],
    sourceDirs: [
      path.join(backendRoot, "src/main/java")
    ],
    frameworks: ["jax-rs"]
  };

  const analysis = await analyzeJavaRepository(
    repository,
    {
      scipIndex: backendIndex,
      scipWorkspace: workspace
    }
  );

  assert.equal(
    analysis.evidence[0]?.status,
    "complete"
  );
  assert.equal(analysis.facts.length, 1);
  assert.equal(
    analysis.facts[0]?.repositoryId,
    "backend"
  );
  assert.equal(
    analysis.facts[0]?.sourceFile,
    backendFile
  );
  assert.equal(
    analysis.facts[0]?.className,
    "ApplicationController"
  );
  assert.equal(
    analysis.facts[0]?.methodName,
    "get"
  );
  assert.equal(
    analysis.facts[0]?.operationKey,
    "GET /applications/{}"
  );
});
