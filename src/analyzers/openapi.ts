import { readFile } from "node:fs/promises";
import path from "node:path";
import { operationKey } from "../core/routes.js";
import type {
  AnalysisResult,
  Fact,
  ResolvedOpenApiRepository
} from "../core/model.js";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace"
]);

type OpenApiDocument = {
  paths?: Record<string, Record<string, { operationId?: string }>>;
  components?: { schemas?: Record<string, unknown> };
};

async function parseDocument(file: string): Promise<OpenApiDocument> {
  const source = await readFile(file, "utf8");
  const ext = path.extname(file).toLowerCase();

  if (ext === ".json") return JSON.parse(source) as OpenApiDocument;

  if (ext === ".yaml" || ext === ".yml") {
    const yaml = await import("yaml");
    return yaml.parse(source) as OpenApiDocument;
  }

  throw new Error(
    `Unsupported OpenAPI file extension: ${ext || "<none>"}`
  );
}

export async function analyzeOpenApiRepository(
  repository: ResolvedOpenApiRepository
): Promise<AnalysisResult> {
  const document = await parseDocument(repository.openapiFile);
  const facts: Fact[] = [];

  for (const [apiPath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) continue;

      const upperMethod = normalizedMethod.toUpperCase();
      facts.push({
        kind: "contract-operation",
        repositoryId: repository.id,
        operationId:
          operation.operationId ?? `${upperMethod} ${apiPath}`,
        method: upperMethod,
        path: apiPath,
        operationKey: operationKey(upperMethod, apiPath)
      });
    }
  }

  for (const schemaName of Object.keys(document.components?.schemas ?? {})) {
    facts.push({
      kind: "contract-schema",
      repositoryId: repository.id,
      name: schemaName
    });
  }

  return {
    facts,
    evidence: [
      {
        repositoryId: repository.id,
        producer: "openapi",
        factKind: "contract-operation",
        status: "complete"
      },
      {
        repositoryId: repository.id,
        producer: "openapi",
        factKind: "contract-schema",
        status: "complete"
      }
    ]
  };
}
