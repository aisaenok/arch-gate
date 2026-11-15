import type {
  Occurrence
} from "@scip-code/scip";
import type { ScipIndex } from "./index.js";

export interface TypeScriptScipSourceRange {
  line: number;
  startCharacter: number;
  endCharacter: number;
}

export interface TypeScriptScipModuleResolution {
  symbol: string;
  targetFile?: string;
  resolved: boolean;
}

function occurrenceRange(
  occurrence: Occurrence
): TypeScriptScipSourceRange | undefined {
  if (occurrence.typedRange.case === "singleLineRange") {
    return {
      line: occurrence.typedRange.value.line,
      startCharacter:
        occurrence.typedRange.value.startCharacter,
      endCharacter:
        occurrence.typedRange.value.endCharacter
    };
  }

  if (
    occurrence.range.length === 3
  ) {
    return {
      line: occurrence.range[0]!,
      startCharacter: occurrence.range[1]!,
      endCharacter: occurrence.range[2]!
    };
  }

  return undefined;
}

function sameRange(
  left: TypeScriptScipSourceRange,
  right: TypeScriptScipSourceRange
): boolean {
  return (
    left.line === right.line &&
    left.startCharacter === right.startCharacter &&
    left.endCharacter === right.endCharacter
  );
}

export function resolveTypeScriptModuleSpecifierWithScip(
  index: ScipIndex,
  sourceFile: string,
  range: TypeScriptScipSourceRange
): TypeScriptScipModuleResolution | undefined {
  const occurrences = index
    .getOccurrences(sourceFile)
    .filter((occurrence) => {
      const current = occurrenceRange(occurrence);
      return current
        ? sameRange(current, range)
        : false;
    })
    .filter((occurrence) => !!occurrence.symbol);

  if (occurrences.length === 0) {
    return undefined;
  }

  const occurrence =
    occurrences.find((candidate) =>
      index.getDefiningDocument(candidate.symbol)
    ) ?? occurrences[0]!;

  const definingDocument =
    index.getDefiningDocument(occurrence.symbol);

  return {
    symbol: occurrence.symbol,
    targetFile: definingDocument?.relativePath,
    resolved: true
  };
}
