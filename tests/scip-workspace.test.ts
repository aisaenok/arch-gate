import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  create,
  toBinary
} from "@bufbuild/protobuf";
import {
  IndexSchema
} from "@scip-code/scip";
import {
  parseScipIndex
} from "../src/scip/index.js";
import {
  ScipWorkspace
} from "../src/scip/workspace.js";

function indexWithDefinition(
  relativePath: string,
  symbol: string
) {
  return parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath,
            symbols: [
              {
                symbol,
                displayName: "Thing"
              }
            ]
          }
        ]
      })
    )
  );
}

test("SCIP workspace resolves a global symbol definition across repositories", () => {
  const symbol =
    "scip-typescript npm generated-client 1.0.0 src/\`models.ts\`/CreateRequest#";
  const consumerIndex =
    parseScipIndex(
      toBinary(
        IndexSchema,
        create(IndexSchema, {
          documents: [
            {
              relativePath: "src/feature.ts",
              occurrences: [
                {
                  range: [0, 10, 23],
                  symbol
                }
              ]
            }
          ],
          externalSymbols: [
            {
              symbol,
              displayName: "CreateRequest"
            }
          ]
        })
      )
    );
  const generatedIndex =
    indexWithDefinition(
      "src/generated/models.ts",
      symbol
    );

  const workspace = new ScipWorkspace([
    {
      repositoryId: "consumer",
      repositoryRoot: "/workspace/consumer",
      index: consumerIndex
    },
    {
      repositoryId: "generated-client",
      repositoryRoot:
        "/workspace/generated-client",
      index: generatedIndex
    }
  ]);

  assert.equal(
    workspace.getIndex("consumer"),
    consumerIndex
  );

  const definition =
    workspace.findDefinition(symbol);

  assert.ok(definition);
  assert.equal(
    definition.repositoryId,
    "generated-client"
  );
  assert.equal(
    definition.document.relativePath,
    "src/generated/models.ts"
  );
  assert.equal(
    definition.absolutePath,
    path.resolve(
      "/workspace/generated-client",
      "src/generated/models.ts"
    )
  );
});

test("SCIP workspace does not federate document-local symbols", () => {
  const localIndex =
    indexWithDefinition(
      "src/local.ts",
      "local 0"
    );
  const workspace = new ScipWorkspace([
    {
      repositoryId: "frontend",
      repositoryRoot: "/workspace/frontend",
      index: localIndex
    }
  ]);

  assert.equal(
    workspace.findDefinition("local 0"),
    undefined
  );
});

test("SCIP workspace reports ambiguous global definitions without losing candidates", () => {
  const symbol =
    "scip-typescript npm shared 1.0.0 src/\`types.ts\`/Shared#";
  const workspace = new ScipWorkspace([
    {
      repositoryId: "first",
      repositoryRoot: "/workspace/first",
      index: indexWithDefinition(
        "src/types.ts",
        symbol
      )
    },
    {
      repositoryId: "second",
      repositoryRoot: "/workspace/second",
      index: indexWithDefinition(
        "src/types.ts",
        symbol
      )
    }
  ]);

  const resolution =
    workspace.resolveDefinition(symbol);

  assert.equal(resolution.status, "ambiguous");
  if (resolution.status === "ambiguous") {
    assert.deepEqual(
      resolution.definitions.map(
        (definition) => definition.repositoryId
      ),
      ["first", "second"]
    );
  }

  assert.throws(
    () => workspace.findDefinition(symbol),
    /definitions in multiple workspace repositories: first, second/
  );
});

test("SCIP workspace resolves implementations across repository indexes", () => {
  const interfaceSymbol =
    "scip-java maven api 1.0.0 dev/example/ApplicationApi#get().";
  const implementationSymbol =
    "scip-java maven backend 1.0.0 dev/example/ApplicationController#get().";

  const interfaceIndex = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath:
              "src/main/java/dev/example/ApplicationApi.java",
            symbols: [
              {
                symbol: interfaceSymbol,
                displayName: "get"
              }
            ]
          }
        ]
      })
    )
  );

  const implementationIndex = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath:
              "src/main/java/dev/example/ApplicationController.java",
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
            ]
          }
        ]
      })
    )
  );

  const workspace = new ScipWorkspace([
    {
      repositoryId: "api",
      repositoryRoot: "/workspace/api",
      index: interfaceIndex
    },
    {
      repositoryId: "backend",
      repositoryRoot: "/workspace/backend",
      index: implementationIndex
    }
  ]);

  const resolution =
    workspace.resolveImplementations(
      interfaceSymbol
    );

  assert.deepEqual(
    resolution.missingImplementationSymbols,
    []
  );
  assert.deepEqual(
    resolution.ambiguousImplementations,
    []
  );
  assert.equal(
    resolution.implementations.length,
    1
  );
  assert.equal(
    resolution.implementations[0]
      ?.implementationSymbol,
    implementationSymbol
  );
  assert.equal(
    resolution.implementations[0]
      ?.definition.repositoryId,
    "backend"
  );
  assert.equal(
    resolution.implementations[0]
      ?.definition.document.relativePath,
    "src/main/java/dev/example/ApplicationController.java"
  );
});

test("SCIP workspace keeps unresolved implementation ownership explicit", () => {
  const interfaceSymbol =
    "scip-java maven api 1.0.0 dev/example/ApplicationApi#get().";
  const missingImplementationSymbol =
    "scip-java maven backend 1.0.0 dev/example/MissingController#get().";

  const relationshipOnlyIndex = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        externalSymbols: [
          {
            symbol: missingImplementationSymbol,
            displayName: "get",
            relationships: [
              {
                symbol: interfaceSymbol,
                isImplementation: true
              }
            ]
          }
        ]
      })
    )
  );

  const workspace = new ScipWorkspace([
    {
      repositoryId: "backend",
      repositoryRoot: "/workspace/backend",
      index: relationshipOnlyIndex
    }
  ]);

  const resolution =
    workspace.resolveImplementations(
      interfaceSymbol
    );

  assert.deepEqual(
    resolution.implementations,
    []
  );
  assert.deepEqual(
    resolution.missingImplementationSymbols,
    [missingImplementationSymbol]
  );
  assert.deepEqual(
    resolution.ambiguousImplementations,
    []
  );
});

test("SCIP workspace rejects duplicate repository ids", () => {
  const index = parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: []
      })
    )
  );

  assert.throws(
    () =>
      new ScipWorkspace([
        {
          repositoryId: "frontend",
          repositoryRoot:
            "/workspace/frontend-a",
          index
        },
        {
          repositoryId: "frontend",
          repositoryRoot:
            "/workspace/frontend-b",
          index
        }
      ]),
    /duplicate SCIP workspace repository "frontend"/
  );
});
