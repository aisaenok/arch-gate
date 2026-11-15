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
  buildArchitectureModel,
  runCheck
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

test("Java SCIP shadow mismatch is diagnostic-only in normal check pipeline", async (t) => {
  const repository =
    await javaInheritanceFixture(t);

  const result = await runCheck(
    gateConfig(repository)
  );

  assert.equal(result.status, "pass");
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.diagnostics?.length, 1);
  assert.equal(
    result.diagnostics?.[0]?.code,
    "SCIP_JAVA_MANUAL_RESOLUTION_MISSING"
  );
  assert.equal(
    result.diagnostics?.[0]?.repositoryId,
    "backend"
  );
  assert.equal(
    result.diagnostics?.[0]?.details?.reason,
    "manual-resolution-missing"
  );
  assert.equal(
    result.diagnostics?.[0]?.details?.interface,
    "dev.test.api.BaseApi#getApplication/1"
  );
  assert.equal(
    result.diagnostics?.[0]?.details?.implementationSource,
    "src/main/java/dev/test/Controller.java:7"
  );
});
