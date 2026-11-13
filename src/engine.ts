import { analyzeOpenApiRepository } from "./analyzers/openapi.js";
import { analyzeTypeScriptRepository } from "./analyzers/typescript.js";
import type {
  ArchitectureModel,
  ContractCatalog,
  ResolvedGateConfig,
  TypeScriptFacts,
  Violation
} from "./core/model.js";
import { checkApiThroughGenerated } from "./rules/api-through-generated.js";
import { checkWireTypesFromContract } from "./rules/wire-types-from-contract.js";

export interface BuildModelOptions {
  analyzeTypeScript?: boolean;
}

export async function buildArchitectureModel(
  config: ResolvedGateConfig,
  options: BuildModelOptions = {}
): Promise<ArchitectureModel> {
  const analyzeTypeScript = options.analyzeTypeScript ?? true;
  const contracts: ContractCatalog[] = [];
  const typescript: TypeScriptFacts[] = [];

  for (const repository of Object.values(config.repositories)) {
    if (repository.type === "openapi") {
      contracts.push(await analyzeOpenApiRepository(repository));
      continue;
    }

    if (repository.type === "typescript" && analyzeTypeScript) {
      typescript.push(await analyzeTypeScriptRepository(repository));
    }
  }

  return {
    repositories: config.repositories,
    contracts,
    typescript
  };
}

export async function runCheck(config: ResolvedGateConfig): Promise<Violation[]> {
  const model = await buildArchitectureModel(config);
  const violations: Violation[] = [];

  if (config.rules.apiThroughGenerated) {
    violations.push(...checkApiThroughGenerated(model, config.rules.apiThroughGenerated));
  }

  if (config.rules.wireTypesFromContract) {
    violations.push(...checkWireTypesFromContract(model, config.rules.wireTypesFromContract));
  }

  return violations;
}
