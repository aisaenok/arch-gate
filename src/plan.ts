import { readFile } from "node:fs/promises";
import type { ArchitectureIntent, ContractCatalog, Violation } from "./model.js";

export async function loadIntent(file: string): Promise<ArchitectureIntent> {
  return JSON.parse(await readFile(file, "utf8")) as ArchitectureIntent;
}

export function checkPlan(intent: ArchitectureIntent, contracts: ContractCatalog): Violation[] {
  const violations: Violation[] = [];

  for (const apiCall of intent.apiCalls ?? []) {
    if (apiCall.consumer !== "pl" || apiCall.provider !== "bh") continue;

    if (!contracts.operationIds.has(apiCall.operationId)) {
      violations.push({
        rule: "PLAN001",
        target: apiCall.operationId,
        message: "Planned PL → BH operation is not declared in api-contracts.",
        details: { expected: "operationId from api-contracts", actual: apiCall.operationId }
      });
    }

    if (apiCall.via !== "generated-runtime") {
      violations.push({
        rule: "PLAN002",
        target: apiCall.operationId,
        message: "Planned PL → BH API access must go through generated runtime API.",
        details: { expected: "generated-runtime", actual: apiCall.via }
      });
    }
  }

  for (const wireType of intent.wireTypes ?? []) {
    if (wireType.consumer !== "pl") continue;

    if (!contracts.schemaNames.has(wireType.name)) {
      violations.push({
        rule: "PLAN003",
        target: wireType.name,
        message: "Planned wire type is not declared in api-contracts.",
        details: { expected: "schema from api-contracts", actual: wireType.name }
      });
    }

    if (wireType.source !== "api-contracts") {
      violations.push({
        rule: "PLAN004",
        target: wireType.name,
        message: "PL wire DTO must originate from api-contracts.",
        details: { expected: "api-contracts", actual: wireType.source }
      });
    }
  }

  return violations;
}
