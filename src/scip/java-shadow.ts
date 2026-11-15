import type {
  JavaImplementationResolution,
  JavaInterfaceEndpointCandidate
} from "../analyzers/java.js";
import {
  javaDefinitionLine,
  javaDefinitionSymbolsAt
} from "./java-resolution.js";
import type { ScipIndex } from "./index.js";

export type JavaScipShadowMismatchReason =
  | "implementation-document-missing"
  | "implementation-definition-missing"
  | "implementation-relationship-missing";

export interface JavaScipShadowMismatch {
  resolution: JavaImplementationResolution;
  reason: JavaScipShadowMismatchReason;
  implementationSymbols: string[];
}

export interface JavaScipShadowResult {
  checked: number;
  matched: number;
  mismatches: JavaScipShadowMismatch[];
}

export type JavaScipReverseMismatchReason =
  | "interface-document-missing"
  | "interface-definition-missing"
  | "implementation-definition-missing"
  | "manual-resolution-missing";

export interface JavaScipReverseMismatch {
  endpoint: JavaInterfaceEndpointCandidate;
  reason: JavaScipReverseMismatchReason;
  interfaceSymbols: string[];
  implementationSymbol?: string;
  implementationSourceFile?: string;
  implementationDefinitionLine?: number;
}

export interface JavaScipReverseResult {
  endpointsChecked: number;
  implementationsChecked: number;
  matched: number;
  mismatches: JavaScipReverseMismatch[];
}

export interface JavaScipParityResult {
  manualToScip: JavaScipShadowResult;
  scipToManual: JavaScipReverseResult;
}

function implementationSymbolsAt(
  index: ScipIndex,
  resolution: JavaImplementationResolution
): string[] {
  return javaDefinitionSymbolsAt(
    index,
    resolution.implementationSourceFile,
    resolution.implementationDefinitionLine,
    resolution.implementationMethodName
  );
}

function hasExpectedImplementationRelationship(
  index: ScipIndex,
  implementationSymbol: string,
  resolution: JavaImplementationResolution
): boolean {
  const information =
    index.getSymbolInformation(implementationSymbol);

  if (!information) return false;

  return information.relationships.some((relationship) => {
    if (!relationship.isImplementation) return false;

    const target =
      index.getSymbolInformation(relationship.symbol);
    const targetDocument =
      index.getDefiningDocument(relationship.symbol);

    return (
      target?.displayName ===
        resolution.interfaceMethodName &&
      targetDocument?.relativePath ===
        resolution.interfaceSourceFile &&
      javaDefinitionLine(index, relationship.symbol) ===
        resolution.interfaceDefinitionLine
    );
  });
}

export function compareJavaImplementationsWithScip(
  resolutions: readonly JavaImplementationResolution[],
  index: ScipIndex
): JavaScipShadowResult {
  const mismatches: JavaScipShadowMismatch[] = [];

  for (const resolution of resolutions) {
    if (
      !index.getDocument(
        resolution.implementationSourceFile
      )
    ) {
      mismatches.push({
        resolution,
        reason: "implementation-document-missing",
        implementationSymbols: []
      });
      continue;
    }

    const implementationSymbols =
      implementationSymbolsAt(index, resolution);

    if (implementationSymbols.length === 0) {
      mismatches.push({
        resolution,
        reason: "implementation-definition-missing",
        implementationSymbols
      });
      continue;
    }

    if (
      !implementationSymbols.some((symbol) =>
        hasExpectedImplementationRelationship(
          index,
          symbol,
          resolution
        )
      )
    ) {
      mismatches.push({
        resolution,
        reason: "implementation-relationship-missing",
        implementationSymbols
      });
    }
  }

  return {
    checked: resolutions.length,
    matched: resolutions.length - mismatches.length,
    mismatches
  };
}

function manualResolutionMatchesScip(
  resolution: JavaImplementationResolution,
  endpoint: JavaInterfaceEndpointCandidate,
  implementationSourceFile: string,
  implementationDefinitionLine: number
): boolean {
  return (
    resolution.interfaceSourceFile ===
      endpoint.interfaceSourceFile &&
    resolution.interfaceDefinitionLine ===
      endpoint.interfaceDefinitionLine &&
    resolution.interfaceMethodName ===
      endpoint.interfaceMethodName &&
    resolution.interfaceArity ===
      endpoint.interfaceArity &&
    resolution.implementationSourceFile ===
      implementationSourceFile &&
    resolution.implementationDefinitionLine ===
      implementationDefinitionLine &&
    resolution.implementationMethodName ===
      endpoint.interfaceMethodName
  );
}

export function compareScipJavaImplementationsWithManual(
  resolutions: readonly JavaImplementationResolution[],
  endpoints: readonly JavaInterfaceEndpointCandidate[],
  index: ScipIndex
): JavaScipReverseResult {
  const mismatches: JavaScipReverseMismatch[] = [];
  let implementationsChecked = 0;
  let matched = 0;

  for (const endpoint of endpoints) {
    if (!index.getDocument(endpoint.interfaceSourceFile)) {
      mismatches.push({
        endpoint,
        reason: "interface-document-missing",
        interfaceSymbols: []
      });
      continue;
    }

    const interfaceSymbols = javaDefinitionSymbolsAt(
      index,
      endpoint.interfaceSourceFile,
      endpoint.interfaceDefinitionLine,
      endpoint.interfaceMethodName
    );

    if (interfaceSymbols.length === 0) {
      mismatches.push({
        endpoint,
        reason: "interface-definition-missing",
        interfaceSymbols
      });
      continue;
    }

    for (const interfaceSymbol of interfaceSymbols) {
      for (
        const implementationSymbol of
        index.getImplementations(interfaceSymbol)
      ) {
        const implementationDocument =
          index.getDefiningDocument(implementationSymbol);

        if (!implementationDocument) {
          continue;
        }

        implementationsChecked += 1;

        const implementationDefinitionLine =
          javaDefinitionLine(index, implementationSymbol);

        if (implementationDefinitionLine === undefined) {
          mismatches.push({
            endpoint,
            reason: "implementation-definition-missing",
            interfaceSymbols,
            implementationSymbol,
            implementationSourceFile:
              implementationDocument.relativePath
          });
          continue;
        }

        const found = resolutions.some((resolution) =>
          manualResolutionMatchesScip(
            resolution,
            endpoint,
            implementationDocument.relativePath,
            implementationDefinitionLine
          )
        );

        if (!found) {
          mismatches.push({
            endpoint,
            reason: "manual-resolution-missing",
            interfaceSymbols,
            implementationSymbol,
            implementationSourceFile:
              implementationDocument.relativePath,
            implementationDefinitionLine
          });
          continue;
        }

        matched += 1;
      }
    }
  }

  return {
    endpointsChecked: endpoints.length,
    implementationsChecked,
    matched,
    mismatches
  };
}

export function compareJavaImplementationParityWithScip(
  resolutions: readonly JavaImplementationResolution[],
  endpoints: readonly JavaInterfaceEndpointCandidate[],
  index: ScipIndex
): JavaScipParityResult {
  return {
    manualToScip: compareJavaImplementationsWithScip(
      resolutions,
      index
    ),
    scipToManual: compareScipJavaImplementationsWithManual(
      resolutions,
      endpoints,
      index
    )
  };
}
