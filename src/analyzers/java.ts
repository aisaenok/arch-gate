import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
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

interface EndpointDraft {
  className: string;
  methodName: string;
  offset: number;
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

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (
    let child = node.firstChild;
    child;
    child = child.nextSibling
  ) {
    result.push(child);
  }
  return result;
}

function directChild(
  node: SyntaxNode,
  name: string
): SyntaxNode | undefined {
  return directChildren(node).find(
    (child) => child.name === name
  );
}

function firstDescendant(
  node: SyntaxNode,
  name: string
): SyntaxNode | undefined {
  for (const child of directChildren(node)) {
    if (child.name === name) return child;
    const nested = firstDescendant(child, name);
    if (nested) return nested;
  }
  return undefined;
}

function annotationNodes(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];

  const visit = (current: SyntaxNode): void => {
    for (const child of directChildren(current)) {
      if (
        child.name === "Annotation" ||
        child.name === "MarkerAnnotation"
      ) {
        result.push(child);
        continue;
      }
      visit(child);
    }
  };

  visit(node);
  return result;
}

function sourceText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function decodeJavaString(raw: string): string {
  const body = raw.slice(1, -1);
  return body
    .replace(/\\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function stringLiterals(text: string): string[] {
  const result: string[] = [];
  const pattern = /"(?:\\.|[^"\\])*"/g;
  for (const match of text.matchAll(pattern)) {
    result.push(decodeJavaString(match[0]));
  }
  return result;
}

function parseAnnotation(text: string): AnnotationInfo | undefined {
  const nameMatch = text.match(
    /^@\s*(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)/
  );
  if (!nameMatch) return undefined;

  const attributes = new Map<string, string>();
  const operationIdMatch = text.match(
    /\boperationId\s*=\s*("(?:\\.|[^"\\])*")/
  );
  if (operationIdMatch) {
    attributes.set(
      "operationId",
      decodeJavaString(operationIdMatch[1])
    );
  }

  return {
    name: nameMatch[1],
    value: stringLiterals(text)[0],
    attributes
  };
}

function annotations(
  node: SyntaxNode | undefined,
  source: string
): AnnotationInfo[] {
  if (!node) return [];
  return annotationNodes(node)
    .map((annotation) =>
      parseAnnotation(sourceText(annotation, source))
    )
    .filter(
      (annotation): annotation is AnnotationInfo =>
        annotation !== undefined
    );
}

function joinPaths(base: string, child: string): string {
  const parts = [base, child]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^\/+|\/+$/g, ""));

  return parts.length === 0
    ? "/"
    : `/${parts.join("/")}`;
}

function definitionName(
  node: SyntaxNode,
  source: string
): string {
  const definition = firstDescendant(node, "Definition");
  return definition ? sourceText(definition, source) : "";
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid;
  }

  return Math.max(1, low);
}

function hasParseError(root: SyntaxNode): boolean {
  const cursor = root.cursor();

  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());

  return false;
}

function endpointFromMethod(
  methodNode: SyntaxNode,
  className: string,
  classPath: string,
  source: string
): EndpointDraft | undefined {
  const modifiers = directChild(methodNode, "Modifiers");
  const methodAnnotations = annotations(modifiers, source);

  const httpAnnotation = methodAnnotations.find((annotation) =>
    HTTP_ANNOTATIONS.has(annotation.name)
  );
  if (!httpAnnotation) return undefined;

  const method =
    HTTP_ANNOTATIONS.get(httpAnnotation.name)!;
  const methodPath =
    methodAnnotations.find(
      (annotation) => annotation.name === "Path"
    )?.value ?? "";

  const operationId =
    methodAnnotations
      .find((annotation) => annotation.name === "Operation")
      ?.attributes.get("operationId") ?? "";

  const header = directChild(methodNode, "methodHeader");
  const declarator = header
    ? firstDescendant(header, "methodDeclarator")
    : undefined;

  return {
    className,
    methodName: declarator
      ? definitionName(declarator, source)
      : "",
    offset: methodNode.from,
    operationId,
    method,
    path: joinPaths(classPath, methodPath)
  };
}

function collectTypeEndpoints(
  typeNode: SyntaxNode,
  source: string
): EndpointDraft[] {
  const modifiers = directChild(typeNode, "Modifiers");
  const classAnnotations = annotations(modifiers, source);
  const classPath =
    classAnnotations.find(
      (annotation) => annotation.name === "Path"
    )?.value ?? "";
  const className = definitionName(typeNode, source);

  const body =
    directChild(typeNode, "ClassBody") ??
    directChild(typeNode, "InterfaceBody");

  if (!body) return [];

  const endpoints: EndpointDraft[] = [];

  for (const child of directChildren(body)) {
    if (child.name === "MethodDeclaration") {
      const endpoint = endpointFromMethod(
        child,
        className,
        classPath,
        source
      );
      if (endpoint) endpoints.push(endpoint);
      continue;
    }

    if (
      child.name === "ClassDeclaration" ||
      child.name === "InterfaceDeclaration"
    ) {
      endpoints.push(...collectTypeEndpoints(child, source));
    }
  }

  return endpoints;
}

function collectEndpoints(
  root: SyntaxNode,
  source: string
): EndpointDraft[] {
  const endpoints: EndpointDraft[] = [];

  for (const child of directChildren(root)) {
    if (
      child.name === "ClassDeclaration" ||
      child.name === "InterfaceDeclaration"
    ) {
      endpoints.push(...collectTypeEndpoints(child, source));
    }
  }

  return endpoints;
}

function endpointFacts(
  repository: ResolvedJavaRepository,
  file: string,
  source: string,
  endpoints: EndpointDraft[]
): Fact[] {
  const sourceFile = relativeToRoot(file, repository.root);
  const starts = lineStarts(source);

  return endpoints.map((endpoint) => ({
    kind: "backend-endpoint",
    repositoryId: repository.id,
    source: `${sourceFile}:${lineAt(starts, endpoint.offset)}:1`,
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

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const tree = parser.parse(source);

    if (hasParseError(tree.topNode)) {
      parseFailures.push(
        `${relativeToRoot(file, repository.root)}: Java syntax tree contains error nodes`
      );
      continue;
    }

    const endpoints = collectEndpoints(tree.topNode, source);
    facts.push(...endpointFacts(
      repository,
      file,
      source,
      endpoints
    ));
  }

  const evidence: FactEvidence = parseFailures.length
    ? {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "partial",
        message:
          `${parseFailures.length} Java file(s) failed syntax parsing: ${parseFailures.slice(0, 3).join("; ")}`
      }
    : {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "complete"
      };

  return {
    facts,
    evidence: [evidence]
  };
}
