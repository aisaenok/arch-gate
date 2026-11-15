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
  IndexSchema,
  SymbolRole
} from "@scip-code/scip";
import {
  buildArchitectureModel
} from "../src/engine.js";
import type {
  ResolvedGateConfig,
  ResolvedJavaRepository
} from "../src/core/model.js";

async function javaFixture(t: test.TestContext): Promise<{
  repository: ResolvedJavaRepository;
  indexFile: string;
}> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "arch-gate-scip-input-")
  );

  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });

  const sourceDir = path.join(root, "src/main/java");
  const packageDir = path.join(sourceDir, "dev/test");
  await mkdir(packageDir, { recursive: true });

  await writeFile(
    path.join(packageDir, "Controller.java"),
    `package dev.test;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/api")
public final class Controller {
    @GET
    @Path("/status")
    public String status() {
        return "ok";
    }
}
`,
    "utf8"
  );

  const indexFile = path.join(root, "index.scip");
  await writeFile(
    indexFile,
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: []
      })
    )
  );

  return {
    indexFile,
    repository: {
      id: "backend",
      type: "java",
      root,
      roles: ["api-provider"],
      sourceDirs: [sourceDir],
      frameworks: ["jax-rs"],
      scipIndexFile: indexFile
    }
  };
}

function gateConfig(
  repository: ResolvedJavaRepository
): ResolvedGateConfig {
  return {
    configFile: "test",
    repositories: {
      backend: repository
    },
    relations: [],
    rules: []
  };
}

test("normal analysis pipeline loads configured Java SCIP input without changing facts", async (t) => {
  const { repository } = await javaFixture(t);

  const model = await buildArchitectureModel(
    gateConfig(repository)
  );

  assert.equal(model.facts.length, 1);
  assert.equal(
    model.facts[0]?.kind,
    "backend-endpoint"
  );
  assert.equal(
    model.facts[0]?.operationKey,
    "GET /api/status"
  );
});

test("configured Java SCIP input is required to be readable", async (t) => {
  const { repository } = await javaFixture(t);
  repository.scipIndexFile = path.join(
    repository.root,
    "missing.scip"
  );

  await assert.rejects(
    () =>
      buildArchitectureModel(
        gateConfig(repository)
      ),
    /ENOENT/
  );
});


async function javaInheritanceFixture(
  t: test.TestContext
): Promise<ResolvedJavaRepository> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "arch-gate-scip-shadow-")
  );

  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });

  const sourceDir = path.join(root, "src/main/java");
  const apiDir = path.join(
    sourceDir,
    "dev/test/api"
  );
  const implementationDir = path.join(
    sourceDir,
    "dev/test"
  );

  await mkdir(apiDir, { recursive: true });

  const baseApi = `package dev.test.api;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/api/applications")
public interface BaseApi {
    @GET
    @Path("/{id}")
    String getApplication(String id);
}
`;

  const applicationApi = `package dev.test.api;

public interface ApplicationApi extends BaseApi {
}
`;

  const controller = `package dev.test;

import dev.test.api.ApplicationApi;

public final class Controller implements ApplicationApi {
    @Override
    public String getApplication(String id) {
        return id;
    }
}
`;

  await Promise.all([
    writeFile(
      path.join(apiDir, "BaseApi.java"),
      baseApi,
      "utf8"
    ),
    writeFile(
      path.join(apiDir, "ApplicationApi.java"),
      applicationApi,
      "utf8"
    ),
    writeFile(
      path.join(
        implementationDir,
        "Controller.java"
      ),
      controller,
      "utf8"
    )
  ]);

  const baseMethod =
    "scip-java maven fixture 1.0.0 dev/test/api/BaseApi#getApplication().";
  const implementationMethod =
    "scip-java maven fixture 1.0.0 dev/test/Controller#getApplication().";

  const indexFile = path.join(root, "index.scip");
  await writeFile(
    indexFile,
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath:
              "src/main/java/dev/test/api/BaseApi.java",
            symbols: [
              {
                symbol: baseMethod,
                displayName: "getApplication"
              }
            ],
            occurrences: [
              {
                range: [9, 11, 9, 25],
                symbol: baseMethod,
                symbolRoles: SymbolRole.Definition
              }
            ]
          },
          {
            relativePath:
              "src/main/java/dev/test/Controller.java",
            symbols: [
              {
                symbol: implementationMethod,
                displayName: "getApplication",
                relationships: [
                  {
                    symbol: baseMethod,
                    isImplementation: true,
                    isReference: true
                  }
                ]
              }
            ],
            occurrences: [
              {
                range: [6, 18, 6, 32],
                symbol: implementationMethod,
                symbolRoles: SymbolRole.Definition
              }
            ]
          }
        ]
      })
    )
  );

  return {
    id: "backend",
    type: "java",
    root,
    roles: ["api-provider"],
    sourceDirs: [sourceDir],
    frameworks: ["jax-rs"],
    scipIndexFile: indexFile
  };
}

test("SCIP-authoritative Java resolution emits endpoint missed by the manual resolver", async (t) => {
  const repository =
    await javaInheritanceFixture(t);

  const model = await buildArchitectureModel(
    gateConfig(repository)
  );

  assert.equal(model.facts.length, 1);
  assert.equal(
    model.facts[0]?.className,
    "Controller"
  );
  assert.equal(
    model.facts[0]?.methodName,
    "getApplication"
  );
  assert.equal(
    model.facts[0]?.operationKey,
    "GET /api/applications/{}"
  );
  assert.equal(
    model.facts[0]?.sourceFile,
    "src/main/java/dev/test/Controller.java"
  );
  assert.equal(
    model.evidence[0]?.status,
    "complete"
  );
});

test("normal SCIP-authoritative pipeline does not run legacy Java shadow resolution", async (t) => {
  const repository =
    await javaInheritanceFixture(t);

  const model = await buildArchitectureModel(
    gateConfig(repository)
  );

  assert.equal(model.facts.length, 1);
  assert.deepEqual(model.diagnostics, []);
});


async function javaDirectInterfaceFixture(
  t: test.TestContext,
  includeScipRelationship: boolean
): Promise<ResolvedJavaRepository> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "arch-gate-scip-authoritative-")
  );

  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });

  const sourceDir = path.join(root, "src/main/java");
  const apiDir = path.join(sourceDir, "dev/test/api");
  const implementationDir = path.join(sourceDir, "dev/test");
  await mkdir(apiDir, { recursive: true });

  const applicationApi = `package dev.test.api;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/api/applications")
public interface ApplicationApi {
    @GET
    @Path("/{id}")
    String getApplication(String id);
}
`;

  const controller = `package dev.test;

import dev.test.api.ApplicationApi;

public final class Controller implements ApplicationApi {
    @Override
    public String getApplication(String id) {
        return id;
    }
}
`;

  await Promise.all([
    writeFile(
      path.join(apiDir, "ApplicationApi.java"),
      applicationApi,
      "utf8"
    ),
    writeFile(
      path.join(implementationDir, "Controller.java"),
      controller,
      "utf8"
    )
  ]);

  const interfaceMethod =
    "scip-java maven fixture 1.0.0 dev/test/api/ApplicationApi#getApplication().";
  const implementationMethod =
    "scip-java maven fixture 1.0.0 dev/test/Controller#getApplication().";

  const indexFile = path.join(root, "index.scip");
  await writeFile(
    indexFile,
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents: [
          {
            relativePath:
              "src/main/java/dev/test/api/ApplicationApi.java",
            symbols: [
              {
                symbol: interfaceMethod,
                displayName: "getApplication"
              }
            ],
            occurrences: [
              {
                range: [9, 11, 9, 25],
                symbol: interfaceMethod,
                symbolRoles: SymbolRole.Definition
              }
            ]
          },
          {
            relativePath:
              "src/main/java/dev/test/Controller.java",
            symbols: [
              {
                symbol: implementationMethod,
                displayName: "getApplication",
                relationships: includeScipRelationship
                  ? [
                      {
                        symbol: interfaceMethod,
                        isImplementation: true,
                        isReference: true
                      }
                    ]
                  : []
              }
            ],
            occurrences: [
              {
                range: [6, 18, 6, 32],
                symbol: implementationMethod,
                symbolRoles: SymbolRole.Definition
              }
            ]
          }
        ]
      })
    )
  );

  return {
    id: "backend",
    type: "java",
    root,
    roles: ["api-provider"],
    sourceDirs: [sourceDir],
    frameworks: ["jax-rs"],
    scipIndexFile: indexFile
  };
}

test("configured SCIP does not invent an interface implementation relation", async (t) => {
  const repository =
    await javaDirectInterfaceFixture(t, false);

  const model = await buildArchitectureModel(
    gateConfig(repository)
  );

  assert.equal(model.facts.length, 0);
  assert.equal(model.evidence[0]?.status, "complete");
  assert.deepEqual(model.diagnostics, []);
});

test("interface endpoint analysis without SCIP is partial instead of guessed", async (t) => {
  const repository =
    await javaDirectInterfaceFixture(t, false);
  delete repository.scipIndexFile;

  const model = await buildArchitectureModel(
    gateConfig(repository)
  );

  assert.equal(model.facts.length, 0);
  assert.equal(model.evidence[0]?.status, "partial");
  assert.match(
    model.evidence[0]?.message ?? "",
    /SCIP index is required/
  );
  assert.deepEqual(model.diagnostics, []);
});
