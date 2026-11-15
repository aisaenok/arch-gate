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
import { IndexSchema } from "@scip-code/scip";
import { buildArchitectureModel } from "../src/engine.js";
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
