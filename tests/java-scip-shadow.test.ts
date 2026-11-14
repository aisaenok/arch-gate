import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  create,
  toBinary
} from "@bufbuild/protobuf";
import {
  IndexSchema,
  SymbolRole
} from "@scip-code/scip";
import {
  analyzeJavaRepository,
  type JavaImplementationResolution
} from "../src/analyzers/java.js";
import type {
  ResolvedJavaRepository
} from "../src/core/model.js";
import {
  compareJavaImplementationsWithScip
} from "../src/scip/java-shadow.js";
import {
  parseScipIndex
} from "../src/scip/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");

function javaRepository(): ResolvedJavaRepository {
  const repositoryRoot = path.join(
    root,
    "fixtures/bh-jaxrs-inherited"
  );

  return {
    id: "backend",
    type: "java",
    root: repositoryRoot,
    roles: ["api-provider"],
    sourceDirs: [
      path.join(repositoryRoot, "src/main/java")
    ],
    frameworks: ["jax-rs"]
  };
}

function syntheticIndex(
  resolution: JavaImplementationResolution,
  includeRelationship: boolean
) {
  const implementationSymbol =
    "scip-java maven fixture 1.0.0 dev/archgate/ApplicationController#getApplication().";
  const interfaceSymbol =
    "scip-java maven fixture 1.0.0 dev/archgate/api/ApplicationApi#getApplication().";

  return parseScipIndex(
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath:
              resolution.implementationSourceFile,
            symbols: [
              {
                symbol: implementationSymbol,
                displayName:
                  resolution.implementationMethodName,
                relationships: includeRelationship
                  ? [
                      {
                        symbol: interfaceSymbol,
                        isImplementation: true,
                        isReference: true
                      }
                    ]
                  : []
              }
            ],
            occurrences: [
              {
                range: [
                  resolution.implementationLine - 1,
                  4,
                  resolution.implementationLine - 1,
                  18
                ],
                symbol: implementationSymbol,
                symbolRoles: SymbolRole.Definition
              }
            ]
          },
          {
            relativePath: resolution.interfaceSourceFile,
            symbols: [
              {
                symbol: interfaceSymbol,
                displayName: resolution.interfaceMethodName
              }
            ]
          }
        ]
      })
    )
  );
}

async function manualResolution():
  Promise<JavaImplementationResolution> {
  const resolutions: JavaImplementationResolution[] = [];

  const analysis = await analyzeJavaRepository(
    javaRepository(),
    {
      onImplementationResolution: (resolution) => {
        resolutions.push(resolution);
      }
    }
  );

  assert.equal(analysis.facts.length, 1);
  assert.equal(resolutions.length, 1);
  return resolutions[0]!;
}

test("manual inherited endpoint resolution is backed by SCIP implementation relationship", async () => {
  const resolution = await manualResolution();
  const result = compareJavaImplementationsWithScip(
    [resolution],
    syntheticIndex(resolution, true)
  );

  assert.equal(result.checked, 1);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.mismatches, []);
});

test("shadow comparison reports disagreement without changing Java facts", async () => {
  const resolution = await manualResolution();
  const result = compareJavaImplementationsWithScip(
    [resolution],
    syntheticIndex(resolution, false)
  );

  assert.equal(result.checked, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.mismatches.length, 1);
  assert.equal(
    result.mismatches[0]?.reason,
    "implementation-relationship-missing"
  );
});
