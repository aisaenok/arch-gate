import { readFile } from "node:fs/promises";
import type {
  AnalysisResult,
  ArchitectureIntent,
  Fact
} from "../core/model.js";

export async function loadIntent(file: string): Promise<ArchitectureIntent> {
  return JSON.parse(await readFile(file, "utf8")) as ArchitectureIntent;
}

export function analyzeIntent(intent: ArchitectureIntent): AnalysisResult {
  const facts: Fact[] = [];

  for (const apiCall of intent.apiCalls ?? []) {
    facts.push({
      kind: "intent-api-call",
      consumerRepositoryId: apiCall.consumer,
      providerRepositoryId: apiCall.provider,
      operationId: apiCall.operationId,
      via: apiCall.via
    });
  }

  for (const wireType of intent.wireTypes ?? []) {
    facts.push({
      kind: "intent-wire-type",
      consumerRepositoryId: wireType.consumer,
      sourceRepositoryId: wireType.source,
      name: wireType.name
    });
  }

  return {
    facts,
    evidence: [
      {
        repositoryId: "@intent",
        producer: "intent",
        factKind: "intent-api-call",
        status: "complete"
      },
      {
        repositoryId: "@intent",
        producer: "intent",
        factKind: "intent-wire-type",
        status: "complete"
      }
    ]
  };
}
