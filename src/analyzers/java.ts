import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  BaseJavaCstVisitorWithDefaults,
  parse
} from "java-parser";
import { operationKey } from "../core/routes.js";
import type {
  AnalysisResult,
  Fact,
  FactEvidence,
  ResolvedJavaRepository
} from "../core/model.js";

const HTTP_ANNOTATIONS = new Map([
  ["GET", "GET"],
  ["POST", "POST"],
  ["PUT", "PUT"],
  ["PATCH", "PATCH"],
  ["DELETE", "DELETE"],
  ["HEAD", "HEAD"],
  ["OPTIONS", "OPTIONS"]
]);

interface AnnotationInfo {
  name: string;
  value?: string;
  attributes: Map<string, string>;
}

interface ClassContext {
  name: string;
  path: string;
}

interface MethodContext {
  name: string;
  line: number;
  annotations: AnnotationInfo[];
}

interface EndpointDraft {
  className: string;
  methodName: string;
  line: number;
  operationId: string;
  method: string;
  path: string;
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function walkJava(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "target" ||
      entry.name === "build" ||
      entry.name === "node_modules"
    ) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJava(absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".java")) {
      files.push(absolute);
    }
  }

  return files;
}

function collectTokens(node: any): any[] {
  if (!node) return [];
  if (node.image !== undefined) return [node];

  const tokens: any[] = [];
  if (node.children) {
    for (const value of Object.values(node.children)) {
      if (!Array.isArray(value)) continue;
      for (const child of value) {
        tokens.push(...collectTokens(child));
      }
    }
  }

  return tokens.sort(
    (left, right) =>
      (left.startOffset ?? 0) - (right.startOffset ?? 0)
  );
}

function textOf(node: any): string | undefined {
  const tokens = collectTokens(node);
  return tokens.length > 0
    ? tokens.map((token) => token.image).join("")
    : undefined;
}

function unquote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith(""") && trimmed.endsWith(""")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function annotationName(ctx: any): string | undefined {
  const identifiers =
    ctx.typeName?.[0]?.children?.Identifier ?? [];
  return identifiers.at(-1)?.image;
}

function annotationInfo(ctx: any): AnnotationInfo | undefined {
  const name = annotationName(ctx);
  if (!name) return undefined;

  const attributes = new Map<string, string>();
  let value: string | undefined;

  if (ctx.elementValue?.[0]) {
    value = unquote(textOf(ctx.elementValue[0]));
  }

  const pairs =
    ctx.elementValuePairList?.[0]?.children?.elementValuePair ?? [];

  for (const pair of pairs) {
    const key = pair.children?.Identifier?.[0]?.image;
    const raw = textOf(pair.children?.elementValue?.[0]);
    if (key && raw !== undefined) {
      attributes.set(key, unquote(raw) ?? raw);
    }
  }

  return { name, value, attributes };
}

function pathFromAnnotation(annotation: AnnotationInfo): string {
  return (
    annotation.value ??
    annotation.attributes.get("value") ??
    ""
  );
}

function joinPaths(base: string, child: string): string {
  const parts = [base, child]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^\/+|\/+$/g, ""));

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function supportsJaxRs(source: string): boolean {
  return (
    source.includes("jakarta.ws.rs.") ||
    source.includes("javax.ws.rs.")
  );
}

class JaxRsVisitor extends BaseJavaCstVisitorWithDefaults {
  readonly endpoints: EndpointDraft[] = [];
  private readonly classStack: ClassContext[] = [];

  constructor() {
    super();
    this.validateVisitor();
  }

  classDeclaration(ctx: any): void {
    const classAnnotations: AnnotationInfo[] = [];

    for (const modifier of ctx.classModifier ?? []) {
      const annotation =
        modifier.children?.annotation?.[0]?.children;
      if (annotation) {
        const info = annotationInfo(annotation);
        if (info) classAnnotations.push(info);
      }
    }

    const classPath = classAnnotations
      .filter((annotation) => annotation.name === "Path")
      .map(pathFromAnnotation)
      .at(0) ?? "";

    const normal = ctx.normalClassDeclaration?.[0];
    const className =
      normal?.children?.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image ??
      "";

    this.classStack.push({
      name: className,
      path: classPath
    });

    if (normal) this.visit(normal);

    this.classStack.pop();
  }

  methodDeclaration(ctx: any): void {
    const currentClass = this.classStack.at(-1);
    if (!currentClass) return;

    const methodCtx: MethodContext = {
      name: "",
      line: 0,
      annotations: []
    };

    const header = ctx.methodHeader?.[0];
    const declarator =
      header?.children?.methodDeclarator?.[0];
    const nameToken =
      declarator?.children?.Identifier?.[0];

    if (nameToken) {
      methodCtx.name = nameToken.image;
      methodCtx.line = nameToken.startLine ?? 0;
    }

    for (const modifier of ctx.methodModifier ?? []) {
      const annotation =
        modifier.children?.annotation?.[0]?.children;
      if (!annotation) continue;
      const info = annotationInfo(annotation);
      if (info) methodCtx.annotations.push(info);
    }

    const httpAnnotation = methodCtx.annotations.find((annotation) =>
      HTTP_ANNOTATIONS.has(annotation.name)
    );
    if (!httpAnnotation) return;

    const method =
      HTTP_ANNOTATIONS.get(httpAnnotation.name)!;
    const methodPath =
      methodCtx.annotations
        .filter((annotation) => annotation.name === "Path")
        .map(pathFromAnnotation)
        .at(0) ?? "";

    const operation =
      methodCtx.annotations.find(
        (annotation) => annotation.name === "Operation"
      );
    const operationId =
      operation?.attributes.get("operationId") ?? "";

    this.endpoints.push({
      className: currentClass.name,
      methodName: methodCtx.name,
      line: methodCtx.line,
      operationId,
      method,
      path: joinPaths(currentClass.path, methodPath)
    });
  }
}

function endpointFacts(
  repository: ResolvedJavaRepository,
  file: string,
  endpoints: EndpointDraft[]
): Fact[] {
  const sourceFile = relativeToRoot(file, repository.root);

  return endpoints.map((endpoint) => ({
    kind: "backend-endpoint",
    repositoryId: repository.id,
    source: `${sourceFile}:${endpoint.line}:1`,
    sourceFile,
    framework: "jax-rs",
    className: endpoint.className,
    methodName: endpoint.methodName,
    operationId: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    operationKey: operationKey(
      endpoint.method,
      endpoint.path
    )
  }));
}

export async function analyzeJavaRepository(
  repository: ResolvedJavaRepository
): Promise<AnalysisResult> {
  if (!repository.frameworks.includes("jax-rs")) {
    return {
      facts: [],
      evidence: [
        {
          repositoryId: repository.id,
          producer: "java",
          factKind: "backend-endpoint",
          status: "unavailable",
          message:
            "No supported Java endpoint framework is declared. Configure frameworks: [jax-rs] to enable JAX-RS endpoint facts."
        }
      ]
    };
  }

  const files = [
    ...new Set(
      (
        await Promise.all(
          repository.sourceDirs.map((dir) => walkJava(dir))
        )
      ).flat()
    )
  ];

  const facts: Fact[] = [];
  const parseFailures: string[] = [];
  let jaxRsFiles = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");

    if (!supportsJaxRs(source)) continue;
    jaxRsFiles += 1;

    try {
      const cst = parse(source);
      const visitor = new JaxRsVisitor();
      visitor.visit(cst);
      facts.push(...endpointFacts(repository, file, visitor.endpoints));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      parseFailures.push(
        `${relativeToRoot(file, repository.root)}: ${message}`
      );
    }
  }

  const evidence: FactEvidence = parseFailures.length
    ? {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "partial",
        message:
          `${parseFailures.length} JAX-RS Java file(s) failed to parse: ${parseFailures.slice(0, 3).join("; ")}`
      }
    : {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "complete",
        message:
          jaxRsFiles === 0
            ? "JAX-RS analysis completed; no JAX-RS source files were found."
            : undefined
      };

  return {
    facts,
    evidence: [evidence]
  };
}
