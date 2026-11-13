import type { FactValue } from "./model.js";

export type FactProducer = "typescript" | "openapi" | "java" | "intent";

export interface FactDefinition {
  producer: FactProducer;
  fields: readonly string[];
}

export const FACT_DEFINITIONS = {
  "http-call": {
    producer: "typescript",
    fields: [
      "repositoryId",
      "source",
      "sourceFile",
      "transport",
      "method",
      "path",
      "operationKey",
      "operationKeyKnown",
      "sourceGenerated",
      "directHttpAllowed"
    ]
  },
  "module-dependency": {
    producer: "typescript",
    fields: [
      "repositoryId",
      "source",
      "sourceFile",
      "specifier",
      "targetFile",
      "resolved",
      "internal"
    ]
  },
  "http-reach": {
    producer: "typescript",
    fields: [
      "repositoryId",
      "source",
      "sourceFile",
      "terminalFile",
      "transport",
      "operationKey",
      "operationKeyKnown",
      "throughGeneratedRuntime",
      "sourceDirectHttpAllowed",
      "path"
    ]
  },
  "type-declaration": {
    producer: "typescript",
    fields: [
      "repositoryId",
      "source",
      "sourceFile",
      "name",
      "declarationKind",
      "definesShape",
      "sourceGenerated"
    ]
  },
  "api-boundary-type": {
    producer: "typescript",
    fields: [
      "repositoryId",
      "source",
      "sourceFile",
      "targetFile",
      "argumentIndex",
      "expectedType",
      "actualType",
      "contractTypeProvenance"
    ]
  },
  "contract-operation": {
    producer: "openapi",
    fields: ["repositoryId", "operationId", "method", "path", "operationKey"]
  },
  "contract-schema": {
    producer: "openapi",
    fields: ["repositoryId", "name"]
  },
  "backend-endpoint": {
    producer: "java",
    fields: ["repositoryId", "source", "operationId", "method", "path", "operationKey"]
  },
  "intent-api-call": {
    producer: "intent",
    fields: ["consumerRepositoryId", "providerRepositoryId", "operationId", "via"]
  },
  "intent-wire-type": {
    producer: "intent",
    fields: ["consumerRepositoryId", "sourceRepositoryId", "name"]
  }
} as const satisfies Record<string, FactDefinition>;

export type KnownFactKind = keyof typeof FACT_DEFINITIONS;

export function isKnownFactKind(kind: string): kind is KnownFactKind {
  return Object.prototype.hasOwnProperty.call(FACT_DEFINITIONS, kind);
}

export function assertKnownFactKind(kind: string, context = "rule"): asserts kind is KnownFactKind {
  if (!isKnownFactKind(kind)) {
    const known = Object.keys(FACT_DEFINITIONS).join(", ");
    throw new Error(`${context} references unknown fact kind "${kind}". Known facts: ${known}`);
  }
}

export function assertFactField(kind: string, field: string, context = "rule"): void {
  assertKnownFactKind(kind, context);
  if (!FACT_DEFINITIONS[kind].fields.includes(field as never)) {
    throw new Error(
      `${context} references unknown field "${field}" on fact "${kind}". Known fields: ${FACT_DEFINITIONS[kind].fields.join(", ")}`
    );
  }
}

export function factValue(value: unknown): FactValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}
