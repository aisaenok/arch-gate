import type {
  AnalysisResult,
  ResolvedJavaRepository
} from "../core/model.js";

export async function analyzeJavaRepository(
  repository: ResolvedJavaRepository
): Promise<AnalysisResult> {
  return {
    facts: [],
    evidence: [
      {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "unavailable",
        message:
          "Java endpoint extraction is not implemented yet; backend endpoint rules cannot be proven."
      }
    ]
  };
}
