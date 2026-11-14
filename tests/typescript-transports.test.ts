import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeTypeScriptRepository } from "../src/analyzers/typescript.js";
import type {
  Fact,
  ResolvedTypeScriptRepository
} from "../src/core/model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../");

function repository(
  fixture: string
): ResolvedTypeScriptRepository {
  const repositoryRoot = path.join(
    root,
    "fixtures",
    fixture
  );

  return {
    id: "frontend",
    type: "typescript",
    root: repositoryRoot,
    roles: ["api-consumer"],
    sourceDir: path.join(repositoryRoot, "src"),
    generatedRuntimeDirs: [
      path.join(repositoryRoot, "src")
    ],
    allowDirectHttpDirs: [],
    allowManualContractTypeDirs: [],
    httpModules: ["axios"]
  };
}

function httpCalls(
  facts: Fact[]
): Fact[] {
  return facts.filter(
    (fact) => fact.kind === "http-call"
  );
}

test("fetch variable alias produces an http-call fact", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-transport-fetch-alias")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "fetch");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/applications/{}"
  );
  assert.equal(
    calls[0]?.operationKeyKnown,
    true
  );
});

test("configured HTTP module variable alias preserves method and route", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-transport-axios-alias")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/applications/{}"
  );
  assert.equal(
    calls[0]?.operationKeyKnown,
    true
  );
});

test("configured HTTP method alias is recognized", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-transport-method-alias")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/applications/{}"
  );
});

test("transport alias chains are followed transitively", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-transport-alias-chain")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "fetch");
  assert.equal(calls[0]?.operationKeyKnown, true);
});


test("axios.create instance preserves transport provenance", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-axios-create-instance")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/applications/{}"
  );
  assert.equal(calls[0]?.operationKeyKnown, true);
});

test("method alias from axios.create instance remains an HTTP call", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-axios-create-method-alias")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(
    calls[0]?.operationKey,
    "GET /api/applications/{}"
  );
});

test("aliased axios create factory preserves instance provenance", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-axios-create-factory-alias")
  );
  const calls = httpCalls(analysis.facts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.transport, "axios");
  assert.equal(calls[0]?.method, "GET");
});


test("axios.create itself is not emitted as an HTTP call", async () => {
  const analysis = await analyzeTypeScriptRepository(
    repository("pl-axios-create-only")
  );

  assert.equal(httpCalls(analysis.facts).length, 0);
});
