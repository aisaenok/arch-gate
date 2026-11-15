import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
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
  analyzeTypeScriptRepository
} from "../src/analyzers/typescript.js";
import type {
  Fact,
  ResolvedTypeScriptRepository
} from "../src/core/model.js";
import {
  parseScipIndex,
  type ScipIndex
} from "../src/scip/index.js";

interface Fixture {
  repository: ResolvedTypeScriptRepository;
  scip: ScipIndex;
  emptyScip: ScipIndex;
}

async function fixture(
  t: test.TestContext
): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      "arch-gate-ts-scip-module-"
    )
  );

  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });

  const sourceDir = path.join(root, "src");
  await mkdir(sourceDir, { recursive: true });

  await Promise.all([
    writeFile(
      path.join(sourceDir, "usage.ts"),
      `import { get } from "./barrel.js";

export const load = () => get("/api/applications");
`,
      "utf8"
    ),
    writeFile(
      path.join(sourceDir, "barrel.ts"),
      `export { get } from "./http.js";
`,
      "utf8"
    ),
    writeFile(
      path.join(sourceDir, "http.ts"),
      `export const get = (url: string) => url;
`,
      "utf8"
    )
  ]);

  const barrelModule =
    "scip-typescript npm fixture 1.0.0 src/\`barrel.ts\`/";
  const httpGet =
    "scip-typescript npm fixture 1.0.0 src/\`http.ts\`/get.";

  const index = create(IndexSchema, {
    documents: [
      {
        relativePath: "src/usage.ts",
        occurrences: [
          {
            range: [0, 9, 12],
            symbol: httpGet
          },
          {
            range: [0, 20, 33],
            symbol: barrelModule
          }
        ]
      },
      {
        relativePath: "src/barrel.ts",
        symbols: [
          {
            symbol: barrelModule,
            displayName: "barrel"
          }
        ]
      },
      {
        relativePath: "src/http.ts",
        symbols: [
          {
            symbol: httpGet,
            displayName: "get"
          }
        ]
      }
    ]
  });

  const emptyIndex = create(IndexSchema, {
    documents: [
      {
        relativePath: "src/usage.ts"
      },
      {
        relativePath: "src/barrel.ts",
        symbols: [
          {
            symbol: barrelModule,
            displayName: "barrel"
          }
        ]
      }
    ]
  });

  return {
    repository: {
      id: "frontend",
      type: "typescript",
      root,
      roles: ["api-consumer"],
      sourceDir,
      generatedRuntimeDirs: [],
      allowDirectHttpDirs: [],
      allowManualContractTypeDirs: [],
      httpModules: ["axios"]
    },
    scip: parseScipIndex(
      toBinary(IndexSchema, index)
    ),
    emptyScip: parseScipIndex(
      toBinary(IndexSchema, emptyIndex)
    )
  };
}

function moduleDependencies(
  facts: Fact[]
): Fact[] {
  return facts.filter(
    (fact) => fact.kind === "module-dependency"
  );
}

test("SCIP module specifier preserves the imported barrel as module dependency target", async (t) => {
  const current = await fixture(t);

  const analysis = await analyzeTypeScriptRepository(
    current.repository,
    {
      scipIndex: current.scip
    }
  );

  const usageDependency = moduleDependencies(
    analysis.facts
  ).find(
    (fact) =>
      fact.sourceFile === "src/usage.ts" &&
      fact.specifier === "./barrel.js"
  );

  assert.ok(usageDependency);
  assert.equal(
    usageDependency.targetFile,
    "src/barrel.ts"
  );
  assert.equal(
    usageDependency.resolved,
    true
  );
  assert.equal(
    usageDependency.internal,
    true
  );

  const evidence = analysis.evidence.find(
    (item) =>
      item.factKind === "module-dependency"
  );
  assert.equal(evidence?.status, "complete");
});

test("configured SCIP is authoritative for TypeScript module resolution", async (t) => {
  const current = await fixture(t);

  const analysis = await analyzeTypeScriptRepository(
    current.repository,
    {
      scipIndex: current.emptyScip
    }
  );

  const usageDependency = moduleDependencies(
    analysis.facts
  ).find(
    (fact) =>
      fact.sourceFile === "src/usage.ts" &&
      fact.specifier === "./barrel.js"
  );

  assert.ok(usageDependency);
  assert.equal(
    usageDependency.targetFile,
    ""
  );
  assert.equal(
    usageDependency.resolved,
    false
  );

  const evidence = analysis.evidence.find(
    (item) =>
      item.factKind === "module-dependency"
  );
  assert.equal(evidence?.status, "partial");
});

test("relative imports without SCIP produce partial module evidence instead of compiler fallback", async (t) => {
  const current = await fixture(t);

  const analysis = await analyzeTypeScriptRepository(
    current.repository
  );

  const usageDependency = moduleDependencies(
    analysis.facts
  ).find(
    (fact) =>
      fact.sourceFile === "src/usage.ts" &&
      fact.specifier === "./barrel.js"
  );

  assert.ok(usageDependency);
  assert.equal(
    usageDependency.targetFile,
    ""
  );
  assert.equal(
    usageDependency.resolved,
    false
  );

  const moduleEvidence = analysis.evidence.find(
    (item) =>
      item.factKind === "module-dependency"
  );
  assert.equal(
    moduleEvidence?.status,
    "partial"
  );
  assert.match(
    moduleEvidence?.message ?? "",
    /lack SCIP module resolution/
  );

  const reachEvidence = analysis.evidence.find(
    (item) =>
      item.factKind === "http-reach"
  );
  assert.equal(
    reachEvidence?.status,
    "partial"
  );
});


test("SCIP transport identity survives a local re-export", async (t) => {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      "arch-gate-ts-scip-transport-"
    )
  );

  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });

  const sourceDir = path.join(root, "src");
  await mkdir(sourceDir, { recursive: true });

  const usageSource = [
    'import { http } from "./barrel.js";',
    "",
    'export const load = () => http.get("/api/admin");',
    ""
  ].join("\n");

  await Promise.all([
    writeFile(
      path.join(sourceDir, "barrel.ts"),
      'export { default as http } from "axios";\n',
      "utf8"
    ),
    writeFile(
      path.join(sourceDir, "usage.ts"),
      usageSource,
      "utf8"
    )
  ]);

  const axiosDefault =
    "scip-typescript npm axios 1.7.9 `index.d.ts`/axios.";
  const barrelModule =
    "scip-typescript npm fixture 1.0.0 src/`barrel.ts`/";

  const usageLines = usageSource.split("\n");
  const importSpecifier =
    '"./barrel.js"';
  const moduleStart =
    usageLines[0]!.indexOf(importSpecifier);
  const httpStart =
    usageLines[2]!.indexOf("http");

  const index = create(IndexSchema, {
    documents: [
      {
        relativePath: "src/usage.ts",
        occurrences: [
          {
            range: [
              0,
              moduleStart,
              moduleStart +
                importSpecifier.length
            ],
            symbol: barrelModule
          },
          {
            range: [
              2,
              httpStart,
              httpStart + 4
            ],
            symbol: axiosDefault
          }
        ]
      },
      {
        relativePath: "src/barrel.ts",
        symbols: [
          {
            symbol: barrelModule,
            displayName: "barrel"
          }
        ]
      }
    ]
  });

  const analysis = await analyzeTypeScriptRepository(
    {
      id: "frontend",
      type: "typescript",
      root,
      roles: ["api-consumer"],
      sourceDir,
      generatedRuntimeDirs: [],
      allowDirectHttpDirs: [],
      allowManualContractTypeDirs: [],
      httpModules: ["axios"]
    },
    {
      scipIndex: parseScipIndex(
        toBinary(IndexSchema, index)
      )
    }
  );

  const calls = analysis.facts.filter(
    (fact) => fact.kind === "http-call"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/admin"
  );
});
