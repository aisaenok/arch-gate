import { analyzeIntent } from "./analyzers/intent.js";
import { analyzeJavaRepository } from "./analyzers/java.js";
import { analyzeOpenApiRepository } from "./analyzers/openapi.js";
import { analyzeTypeScriptRepository } from "./analyzers/typescript.js";
import { evaluateRules } from "./core/engine.js";
import type {
  AnalysisResult,
  ArchitectureIntent,
  ArchitectureModel,
  Fact,
  FactEvidence,
  ResolvedGateConfig,
  EvaluationResult
} from "./core/model.js";

export interface BuildModelOptions {
  analyzeTypeScript?: boolean;
  extraAnalysis?: AnalysisResult;
}

export async function buildArchitectureModel(
  config: ResolvedGateConfig,
  options: BuildModelOptions = {}
): Promise<ArchitectureModel> {
  const analyzeTypeScript = options.analyzeTypeScript ?? true;
  const facts: Fact[] = [...(options.extraAnalysis?.facts ?? [])];
  const evidence: FactEvidence[] = [
    ...(options.extraAnalysis?.evidence ?? [])
  ];

  for (const repository of Object.values(config.repositories)) {
    let analysis: AnalysisResult | undefined;

    if (repository.type === "openapi") {
      analysis = await analyzeOpenApiRepository(repository);
    } else if (
      repository.type === "typescript" &&
      analyzeTypeScript
    ) {
      analysis = await analyzeTypeScriptRepository(repository);
    } else if (repository.type === "java") {
      analysis = await analyzeJavaRepository(repository);
    }

    if (analysis) {
      facts.push(...analysis.facts);
      evidence.push(...analysis.evidence);
    }
  }

  return {
    repositories: config.repositories,
    relations: config.relations,
    facts,
    evidence
  };
}

export async function runCheck(
  config: ResolvedGateConfig
): Promise<EvaluationResult> {
  const model = await buildArchitectureModel(config);
  return evaluateRules(model, config.rules, "check");
}

export async function runPlan(
  config: ResolvedGateConfig,
  intent: ArchitectureIntent
): Promise<EvaluationResult> {
  const model = await buildArchitectureModel(config, {
    analyzeTypeScript: false,
    extraAnalysis: analyzeIntent(intent)
  });

  return evaluateRules(model, config.rules, "plan");
}
