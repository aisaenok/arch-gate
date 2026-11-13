import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/load.js";

async function configFile(source: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "arch-gate-config-")
  );
  const file = path.join(directory, "arch-gate.yml");
  await writeFile(file, source, "utf8");
  return file;
}

test("rejects relations that reference unknown repositories", async () => {
  const file = await configFile(`
repositories:
  contracts:
    type: openapi
    root: .
    roles: [api-contract]
    openapi: openapi.yaml

relations:
  - type: implemented-by
    from: contracts
    to: missing-backend

rules: []
`);

  await assert.rejects(
    () => loadConfig(file),
    /unknown target repository "missing-backend"/
  );
});

test("rejects rules that reference unknown relation types", async () => {
  const file = await configFile(`
repositories:
  contracts:
    type: openapi
    root: .
    roles: [api-contract]
    openapi: openapi.yaml

  backend:
    type: java
    root: .
    roles: [api-provider]

relations:
  - type: implemented-by
    from: contracts
    to: backend

rules:
  - id: TOPO001
    description: typo must not silently broaden topology
    select:
      fact: contract-operation
    assert:
      - field: operationKey
        memberOf:
          fact: backend-endpoint
          field: operationKey
          repositoryRelation:
            type: implementd-by
            currentField: repositoryId
            candidateField: repositoryId
`);

  await assert.rejects(
    () => loadConfig(file),
    /unknown repository relation type "implementd-by"/
  );
});
