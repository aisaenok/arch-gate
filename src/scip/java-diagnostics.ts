import type {
  AnalysisDiagnostic
} from "../core/model.js";
import type {
  JavaScipParityResult
} from "./java-shadow.js";

function methodKey(
  owner: string,
  method: string,
  arity: number
): string {
  return `${owner}#${method}/${arity}`;
}

export function javaScipParityDiagnostics(
  repositoryId: string,
  parity: JavaScipParityResult
): AnalysisDiagnostic[] {
  const diagnostics: AnalysisDiagnostic[] = [];

  for (const mismatch of parity.manualToScip.mismatches) {
    diagnostics.push({
      severity: "warning",
      code: "SCIP_JAVA_SHADOW_MISMATCH",
      repositoryId,
      message:
        "Manual Java implementation resolution is not confirmed by SCIP.",
      details: {
        direction: "manual-to-scip",
        reason: mismatch.reason,
        interface: methodKey(
          mismatch.resolution.interfaceFqn,
          mismatch.resolution.interfaceMethodName,
          mismatch.resolution.interfaceArity
        ),
        implementation: methodKey(
          mismatch.resolution.implementationClassName,
          mismatch.resolution.implementationMethodName,
          mismatch.resolution.implementationArity
        ),
        implementationSource:
          `${mismatch.resolution.implementationSourceFile}:${mismatch.resolution.implementationDefinitionLine}`
      }
    });
  }

  for (const mismatch of parity.scipToManual.mismatches) {
    diagnostics.push({
      severity: "warning",
      code:
        mismatch.reason === "manual-resolution-missing"
          ? "SCIP_JAVA_MANUAL_RESOLUTION_MISSING"
          : "SCIP_JAVA_SHADOW_MISMATCH",
      repositoryId,
      message:
        mismatch.reason === "manual-resolution-missing"
          ? "SCIP found a Java implementation relation that the manual resolver missed."
          : "SCIP Java shadow comparison could not establish parity.",
      details: {
        direction: "scip-to-manual",
        reason: mismatch.reason,
        interface: methodKey(
          mismatch.endpoint.interfaceFqn,
          mismatch.endpoint.interfaceMethodName,
          mismatch.endpoint.interfaceArity
        ),
        ...(mismatch.implementationSourceFile
          ? {
              implementationSource:
                mismatch.implementationDefinitionLine !== undefined
                  ? `${mismatch.implementationSourceFile}:${mismatch.implementationDefinitionLine}`
                  : mismatch.implementationSourceFile
            }
          : {}),
        ...(mismatch.implementationSymbol
          ? {
              implementationSymbol:
                mismatch.implementationSymbol
            }
          : {})
      }
    });
  }

  return diagnostics;
}
