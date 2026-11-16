import { analyzeIntent } from "./analyzers/intent.js";
import { analyzeJavaRepository } from "./analyzers/java.js";
import { analyzeOpenApiRepository } from "./analyzers/openapi.js";
import { analyzeTypeScriptRepository } from "./analyzers/typescript.js";
import { evaluateRules } from "./core/engine.js";
import {
  loadScipWorkspace
} from "./scip/input.js";
import type {
  AnalysisDiagnostic,
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
  const diagnostics: AnalysisDiagnostic[] = [
    ...(options.extraAnalysis?.diagnostics ?? [])
  ];

  const analyzedRepositories = Object.values(
    config.repositories
  ).filter(
    (repository) =>
      repository.type === "java" ||
      (repository.type === "typescript" &&
        analyzeTypeScript)
  );
  const scipWorkspace =
    await loadScipWorkspace(
      analyzedRepositories
    );

  for (const repository of Object.values(config.repositories)) {
    let analysis: AnalysisResult | undefined;

    if (repository.type === "openapi") {
      analysis = await analyzeOpenApiRepository(repository);
    } else if (
      repository.type === "typescript" &&
      analyzeTypeScript
    ) {
      analysis = await analyzeTypeScriptRepository(
        repository,
        {
          scipIndex:
            scipWorkspace.getIndex(
              repository.id
            )
        }
      );
    } else if (repository.type === "java") {
      analysis = await analyzeJavaRepository(repository, {
        scipIndex:
          scipWorkspace.getIndex(
            repository.id
          )
      });
    }

    if (analysis) {
      facts.push(...analysis.facts);
      evidence.push(...analysis.evidence);
      diagnostics.push(...(analysis.diagnostics ?? []));
    }
  }

  return {
    repositories: config.repositories,
    relations: config.relations,
    facts,
    evidence,
    diagnostics
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
