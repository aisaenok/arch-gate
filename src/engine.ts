import { analyzeIntent } from "./analyzers/intent.js";
import { analyzeOpenApiRepository } from "./analyzers/openapi.js";
import { analyzeTypeScriptRepository } from "./analyzers/typescript.js";
import { evaluateRules } from "./core/engine.js";
import type {
  ArchitectureIntent,
  ArchitectureModel,
  Fact,
  ResolvedGateConfig,
  Violation
} from "./core/model.js";

export interface BuildModelOptions {
  analyzeTypeScript?: boolean;
  extraFacts?: Fact[];
}

export async function buildArchitectureModel(
  config: ResolvedGateConfig,
  options: BuildModelOptions = {}
): Promise<ArchitectureModel> {
  const analyzeTypeScript = options.analyzeTypeScript ?? true;
  const facts: Fact[] = [...(options.extraFacts ?? [])];

  for (const repository of Object.values(config.repositories)) {
    if (repository.type === "openapi") {
      facts.push(...await analyzeOpenApiRepository(repository));
      continue;
    }

    if (repository.type === "typescript" && analyzeTypeScript) {
      facts.push(...await analyzeTypeScriptRepository(repository));
    }
  }

  return {
    repositories: config.repositories,
    facts
  };
}

export async function runCheck(config: ResolvedGateConfig): Promise<Violation[]> {
  const model = await buildArchitectureModel(config);
  return evaluateRules(model, config.rules, "check");
}

export async function runPlan(
  config: ResolvedGateConfig,
  intent: ArchitectureIntent
): Promise<Violation[]> {
  const model = await buildArchitectureModel(config, {
    analyzeTypeScript: false,
    extraFacts: analyzeIntent(intent)
  });

  return evaluateRules(model, config.rules, "plan");
}
