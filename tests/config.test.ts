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


test("rejects unknown repository relation quantifier", async () => {
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
  - id: Q001
    description: bad quantifier
    select:
      fact: contract-operation
    assert:
      - field: operationKey
        memberOf:
          fact: backend-endpoint
          field: operationKey
          repositoryRelation:
            type: implemented-by
            currentField: repositoryId
            candidateField: repositoryId
            quantifier: every
`);

  await assert.rejects(
    () => loadConfig(file),
    /repositoryRelation.quantifier must be any or all/
  );
});


test("rejects repositoryRelation with both direct type and path", async () => {
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
  - id: PATH001
    description: ambiguous path
    select:
      fact: contract-operation
    assert:
      - field: operationKey
        memberOf:
          fact: backend-endpoint
          field: operationKey
          repositoryRelation:
            type: implemented-by
            path:
              - type: implemented-by
            currentField: repositoryId
            candidateField: repositoryId
`);

  await assert.rejects(
    () => loadConfig(file),
    /must define exactly one of type or path/
  );
});

test("rejects empty repository relation path", async () => {
  const file = await configFile(`
repositories:
  contracts:
    type: openapi
    root: .
    roles: [api-contract]
    openapi: openapi.yaml

rules:
  - id: PATH001
    description: empty path
    select:
      fact: contract-operation
    assert:
      - field: operationKey
        memberOf:
          fact: contract-operation
          field: operationKey
          repositoryRelation:
            path: []
            currentField: repositoryId
            candidateField: repositoryId
`);

  await assert.rejects(
    () => loadConfig(file),
    /path must be a non-empty array/
  );
});

test("rejects unknown relation type inside repository path", async () => {
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
  - id: PATH001
    description: typo in path
    select:
      fact: contract-operation
    assert:
      - field: operationKey
        memberOf:
          fact: backend-endpoint
          field: operationKey
          repositoryRelation:
            path:
              - type: implementd-by
            currentField: repositoryId
            candidateField: repositoryId
`);

  await assert.rejects(
    () => loadConfig(file),
    /unknown repository relation type "implementd-by" in path\[0\]/
  );
});
