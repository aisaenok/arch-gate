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


export function resolveTypeScriptSymbolAtRange(
  index: ScipIndex,
  sourceFile: string,
  range: TypeScriptScipSourceRange
): string | undefined {
  return index
    .getOccurrences(sourceFile)
    .find((occurrence) => {
      const current = occurrenceRange(occurrence);
      return (
        !!occurrence.symbol &&
        !!current &&
        sameRange(current, range)
      );
    })
    ?.symbol;
}

export function typeScriptExternalPackageName(
  symbol: string
): string | undefined {
  const match =
    /^scip-typescript npm ([^ ]+) ([^ ]+) /.exec(
      symbol
    );
  return match?.[1];
}

export function typeScriptExternalMemberName(
  symbol: string
): string | undefined {
  const descriptor =
    symbol.slice(symbol.lastIndexOf("/") + 1);
  const member =
    descriptor.includes("#")
      ? descriptor.slice(
          descriptor.lastIndexOf("#") + 1
        )
      : descriptor;

  const match =
    /^([^().]+)(?:\(\))?\.$/.exec(member);

  return match?.[1];
}

export function resolveTypeScriptModuleSpecifierWithScip(
  index: ScipIndex,
  sourceFile: string,
  range: TypeScriptScipSourceRange
): TypeScriptScipModuleResolution | undefined {
  const symbol =
    resolveTypeScriptSymbolAtRange(
      index,
      sourceFile,
      range
    );

  if (!symbol) {
    return undefined;
  }

  const definingDocument =
    index.getDefiningDocument(symbol);

  return {
    symbol,
    targetFile: definingDocument?.relativePath,
    resolved: true
  };
}
