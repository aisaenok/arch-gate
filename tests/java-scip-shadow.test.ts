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
  type JavaImplementationResolution,
  type JavaInterfaceEndpointCandidate
} from "../src/analyzers/java.js";
import type {
  ResolvedJavaRepository
} from "../src/core/model.js";
import {
  compareJavaImplementationParityWithScip,
  compareJavaImplementationsWithScip,
  compareScipJavaImplementationsWithManual
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
                  resolution.implementationDefinitionLine - 1,
                  18,
                  resolution.implementationDefinitionLine - 1,
                  32
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
            ],
            occurrences: [
              {
                range: [
                  resolution.interfaceDefinitionLine - 1,
                  11,
                  resolution.interfaceDefinitionLine - 1,
                  25
                ],
                symbol: interfaceSymbol,
                symbolRoles: SymbolRole.Definition
              }
            ]
          }
        ]
      })
    )
  );
}

interface ManualContext {
  resolution: JavaImplementationResolution;
  endpoint: JavaInterfaceEndpointCandidate;
}

async function manualContext(): Promise<ManualContext> {
  const resolutions: JavaImplementationResolution[] = [];
  const endpoints: JavaInterfaceEndpointCandidate[] = [];

  const analysis = await analyzeJavaRepository(
    javaRepository(),
    {
      onImplementationResolution: (resolution) => {
        resolutions.push(resolution);
      },
      onInterfaceEndpoint: (endpoint) => {
        endpoints.push(endpoint);
      }
    }
  );

  assert.equal(analysis.facts.length, 1);
  assert.equal(resolutions.length, 1);
  assert.equal(endpoints.length, 1);

  return {
    resolution: resolutions[0]!,
    endpoint: endpoints[0]!
  };
}

test("SCIP comparison anchors on the method definition rather than annotation line", async () => {
  const { resolution } = await manualContext();

  assert.equal(resolution.implementationLine, 6);
  assert.equal(resolution.implementationDefinitionLine, 7);
  assert.equal(resolution.interfaceDefinitionLine, 10);

  const result = compareJavaImplementationsWithScip(
    [resolution],
    syntheticIndex(resolution, true)
  );

  assert.equal(result.checked, 1);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.mismatches, []);
});

test("manual inherited endpoint resolution is backed by SCIP in both directions", async () => {
  const { resolution, endpoint } =
    await manualContext();

  const result =
    compareJavaImplementationParityWithScip(
      [resolution],
      [endpoint],
      syntheticIndex(resolution, true)
    );

  assert.equal(result.manualToScip.matched, 1);
  assert.deepEqual(
    result.manualToScip.mismatches,
    []
  );
  assert.equal(
    result.scipToManual.implementationsChecked,
    1
  );
  assert.equal(result.scipToManual.matched, 1);
  assert.deepEqual(
    result.scipToManual.mismatches,
    []
  );
});

test("forward shadow comparison reports a manual relation that SCIP does not confirm", async () => {
  const { resolution } = await manualContext();
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

test("reverse shadow comparison reports a SCIP implementation missed by the manual resolver", async () => {
  const { resolution, endpoint } =
    await manualContext();

  const result =
    compareScipJavaImplementationsWithManual(
      [],
      [endpoint],
      syntheticIndex(resolution, true)
    );

  assert.equal(result.endpointsChecked, 1);
  assert.equal(result.implementationsChecked, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.mismatches.length, 1);
  assert.equal(
    result.mismatches[0]?.reason,
    "manual-resolution-missing"
  );
  assert.equal(
    result.mismatches[0]?.implementationSourceFile,
    resolution.implementationSourceFile
  );
  assert.equal(
    result.mismatches[0]?.implementationDefinitionLine,
    resolution.implementationDefinitionLine
  );
});
