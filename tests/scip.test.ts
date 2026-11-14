import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  create,
  toBinary
} from "@bufbuild/protobuf";
import { IndexSchema } from "@scip-code/scip";
import {
  loadScipIndex,
  parseScipIndex
} from "../src/scip/index.js";

const httpClient =
  "scip-typescript npm fixture 1.0.0 src/types.ts/HttpClient#";
const fetchClient =
  "scip-typescript npm fixture 1.0.0 src/types.ts/FetchClient#";
const axiosGet =
  "scip-typescript npm axios 1.7.9 index.d.ts/Axios#get().";

function fixtureBytes(): Uint8Array {
  const index = create(IndexSchema, {
    documents: [
      {
        relativePath: "src/types.ts",
        symbols: [
          {
            symbol: httpClient
          },
          {
            symbol: fetchClient,
            relationships: [
              {
                symbol: httpClient,
                isImplementation: true
              }
            ]
          }
        ],
        occurrences: [
          {
            range: [0, 17, 0, 27],
            symbol: httpClient
          }
        ]
      }
    ],
    externalSymbols: [
      {
        symbol: axiosGet,
        displayName: "get"
      }
    ]
  });

  return toBinary(IndexSchema, index);
}

test("SCIP adapter indexes local and external symbols", () => {
  const index = parseScipIndex(fixtureBytes());

  assert.equal(
    index.getDefiningDocument(httpClient)?.relativePath,
    "src/types.ts"
  );
  assert.equal(
    index.getSymbolInformation(axiosGet)?.displayName,
    "get"
  );
  assert.deepEqual(
    index.getImplementations(httpClient),
    [fetchClient]
  );
  assert.equal(
    index.getOccurrences("src/types.ts").length,
    1
  );
});

test("SCIP adapter reads index.scip from disk", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "arch-gate-scip-")
  );
  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const path = join(directory, "index.scip");
  await writeFile(path, fixtureBytes());

  const index = await loadScipIndex(path);

  assert.equal(
    index.getDocument("src/types.ts")?.relativePath,
    "src/types.ts"
  );
  assert.deepEqual(
    index.getImplementations(httpClient),
    [fetchClient]
  );
});
