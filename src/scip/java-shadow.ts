import {
  SymbolRole,
  type Occurrence
} from "@scip-code/scip";
import type {
  JavaImplementationResolution
} from "../analyzers/java.js";
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

function occurrenceStartLine(
  occurrence: Occurrence
): number | undefined {
  if (occurrence.typedRange.case === "singleLineRange") {
    return occurrence.typedRange.value.line;
  }

  if (occurrence.typedRange.case === "multiLineRange") {
    return occurrence.typedRange.value.startLine;
  }

  return occurrence.range[0];
}

function isDefinition(
  occurrence: Occurrence
): boolean {
  return (
    (occurrence.symbolRoles & SymbolRole.Definition) !== 0
  );
}

function implementationSymbolsAt(
  index: ScipIndex,
  resolution: JavaImplementationResolution
): string[] {
  return index
    .getOccurrences(resolution.implementationSourceFile)
    .filter(
      (occurrence) =>
        isDefinition(occurrence) &&
        occurrenceStartLine(occurrence) ===
          resolution.implementationLine - 1
    )
    .filter((occurrence) => {
      const information = index.getSymbolInformation(
        occurrence.symbol
      );

      return (
        information?.displayName ===
        resolution.implementationMethodName
      );
    })
    .map((occurrence) => occurrence.symbol);
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
        resolution.interfaceSourceFile
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
