import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { operationKey } from "../core/routes.js";
import type { ScipIndex } from "../scip/index.js";
import {
  resolveTypeScriptModuleSpecifierWithScip,
  resolveTypeScriptSymbolAtRange,
  typeScriptExternalMemberName,
  typeScriptExternalPackageName,
  type TypeScriptScipSourceRange
} from "../scip/typescript-resolution.js";
import type {
  AnalysisResult,
  Fact,
  FactEvidence,
  ResolvedTypeScriptRepository
} from "../core/model.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options"
]);

const STANDARD_CALLBACK_METHODS = new Map<
  string,
  readonly number[]
>([
  ["map", [0]],
  ["forEach", [0]],
  ["filter", [0]],
  ["some", [0]],
  ["every", [0]],
  ["find", [0]],
  ["findIndex", [0]],
  ["flatMap", [0]],
  ["reduce", [0]],
  ["reduceRight", [0]],
  ["sort", [0]],
  ["then", [0, 1]],
  ["catch", [0]],
  ["finally", [0]]
]);

const STANDARD_CALLBACK_FUNCTIONS = new Map<
  string,
  readonly number[]
>([
  ["queueMicrotask", [0]],
  ["requestAnimationFrame", [0]]
]);

interface TransportBinding {
  module: string;
  importedName?: string;
}

interface HttpCallRecord {
  fact: Fact;
  sourceFile: string;
  sourceAbsolute: string;
  scopeId: string;
}

interface ExecutableScope {
  id: string;
  sourceFile: string;
  sourceAbsolute: string;
  generated: boolean;
}

interface DynamicDispatchRecord {
  candidateScopes: Set<string>;
}

export interface TypeScriptAnalysisOptions {
  scipIndex?: ScipIndex;
}

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isInsideAny(file: string, directories: string[]): boolean {
  return directories.some((directory) => isInside(file, directory));
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(absolute);
    }
  }

  return files;
}

function compilerOptions(repository: ResolvedTypeScriptRepository): ts.CompilerOptions {
  const configFile = ts.findConfigFile(
    repository.root,
    ts.sys.fileExists,
    "tsconfig.json"
  );

  if (configFile) {
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configFile)
      );
      return parsed.options;
    }
  }

  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true
  };
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  );
  return `${line + 1}:${character + 1}`;
}

function scipRange(
  sourceFile: ts.SourceFile,
  node: ts.Node
): TypeScriptScipSourceRange | undefined {
  const start =
    sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
  const end =
    sourceFile.getLineAndCharacterOfPosition(
      node.getEnd()
    );

  if (start.line !== end.line) {
    return undefined;
  }

  return {
    line: start.line,
    startCharacter: start.character,
    endCharacter: end.character
  };
}

function npmPackageName(
  moduleSpecifier: string
): string {
  if (moduleSpecifier.startsWith("@")) {
    return moduleSpecifier
      .split("/")
      .slice(0, 2)
      .join("/");
  }

  return moduleSpecifier.split("/")[0]!;
}

function configuredTransportModule(
  symbol: string,
  modules: string[]
): string | undefined {
  const packageName =
    typeScriptExternalPackageName(symbol);

  if (!packageName) {
    return undefined;
  }

  return modules.find(
    (moduleName) =>
      npmPackageName(moduleName) === packageName
  );
}

function scipSymbolForNode(
  node: ts.Node,
  repository: ResolvedTypeScriptRepository,
  scipIndex: ScipIndex | undefined
): string | undefined {
  if (!scipIndex) {
    return undefined;
  }

  const sourceFile = node.getSourceFile();
  const range = scipRange(sourceFile, node);

  if (!range) {
    return undefined;
  }

  return resolveTypeScriptSymbolAtRange(
    scipIndex,
    relativeToRoot(
      sourceFile.fileName,
      repository.root
    ),
    range
  );
}

function transportBindingFromScip(
  node: ts.Node,
  repository: ResolvedTypeScriptRepository,
  scipIndex: ScipIndex | undefined,
  importedNameOverride?: string
): TransportBinding | undefined {
  const symbol = scipSymbolForNode(
    node,
    repository,
    scipIndex
  );

  if (!symbol) {
    return undefined;
  }

  const packageName =
    typeScriptExternalPackageName(symbol);
  const memberName =
    typeScriptExternalMemberName(symbol);

  if (
    packageName === "typescript" &&
    memberName === "fetch"
  ) {
    return {
      module: "fetch",
      importedName: "default"
    };
  }

  const moduleName = configuredTransportModule(
    symbol,
    repository.httpModules
  );

  if (!moduleName) {
    return undefined;
  }

  const semanticName =
    importedNameOverride ??
    (memberName &&
    (HTTP_METHODS.has(
      memberName.toLowerCase()
    ) ||
      memberName === "create")
      ? memberName
      : "default");

  return {
    module: moduleName,
    importedName: semanticName
  };
}

function isTransportFactory(
  binding: TransportBinding
): boolean {
  return (
    binding.module === "axios" &&
    binding.importedName === "create"
  );
}

function resolveTransportExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  repository: ResolvedTypeScriptRepository,
  scipIndex: ScipIndex | undefined,
  seen = new Set<ts.Symbol>()
): TransportBinding | undefined {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return resolveTransportExpression(
      expression.expression,
      checker,
      repository,
      scipIndex,
      seen
    );
  }

  if (ts.isCallExpression(expression)) {
    const factory = resolveTransportExpression(
      expression.expression,
      checker,
      repository,
      scipIndex,
      seen
    );

    if (factory && isTransportFactory(factory)) {
      return {
        module: "axios",
        importedName: "default"
      };
    }

    return undefined;
  }

  if (ts.isIdentifier(expression)) {
    const direct = transportBindingFromScip(
      expression,
      repository,
      scipIndex
    );

    if (direct) {
      return direct;
    }

    let symbol = checker.getSymbolAtLocation(expression);

    if (
      symbol &&
      (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ) {
      symbol = checker.getAliasedSymbol(symbol);
    }

    if (!symbol || seen.has(symbol)) {
      return undefined;
    }

    seen.add(symbol);

    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer
      ) {
        const resolved = resolveTransportExpression(
          declaration.initializer,
          checker,
          repository,
          scipIndex,
          seen
        );
        if (resolved) return resolved;
      }
    }

    return undefined;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const direct = transportBindingFromScip(
      expression.name,
      repository,
      scipIndex,
      expression.name.text
    );

    if (direct) {
      return direct;
    }

    const base = resolveTransportExpression(
      expression.expression,
      checker,
      repository,
      scipIndex,
      seen
    );

    return base
      ? {
          ...base,
          importedName: expression.name.text
        }
      : undefined;
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    const base = resolveTransportExpression(
      expression.expression,
      checker,
      repository,
      scipIndex,
      seen
    );

    return base
      ? {
          ...base,
          importedName:
            expression.argumentExpression.text
        }
      : undefined;
  }

  return undefined;
}

function staticPath(
  expression: ts.Expression | undefined
): string | undefined {
  if (!expression) return undefined;

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value += "{}";
      value += span.literal.text;
    }
    return value;
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind ===
      ts.SyntaxKind.PlusToken
  ) {
    const left = staticPath(expression.left);
    const right = staticPath(expression.right);
    if (
      left !== undefined &&
      right !== undefined
    ) {
      return left + right;
    }
    if (left !== undefined) return left + "{}";
    if (right !== undefined) return "{}" + right;
  }

  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) ||
      ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
    if (propertyName === name) {
      return property.initializer;
    }
  }
  return undefined;
}

function stringValue(
  expression: ts.Expression | undefined
): string | undefined {
  if (
    expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
  ) {
    return expression.text;
  }
  return undefined;
}

function fetchMethod(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (
    options &&
    ts.isObjectLiteralExpression(options)
  ) {
    return (
      stringValue(objectProperty(options, "method")) ??
      "GET"
    ).toUpperCase();
  }
  return "GET";
}

function moduleSpecifierScipRange(
  sourceFile: ts.SourceFile,
  moduleSpecifier: ts.StringLiteral
): TypeScriptScipSourceRange | undefined {
  const start = sourceFile.getLineAndCharacterOfPosition(
    moduleSpecifier.getStart(sourceFile)
  );
  const end = sourceFile.getLineAndCharacterOfPosition(
    moduleSpecifier.getEnd()
  );

  if (start.line !== end.line) {
    return undefined;
  }

  return {
    line: start.line,
    startCharacter: start.character,
    endCharacter: end.character
  };
}

function declarationKind(
  node:
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.ClassDeclaration
): string {
  if (ts.isInterfaceDeclaration(node)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return "type";
  }
  return "class";
}

function aliasDefinesShape(
  node: ts.TypeAliasDeclaration
): boolean {
  return !(
    ts.isTypeReferenceNode(node.type) ||
    ts.isTypeQueryNode(node.type) ||
    ts.isImportTypeNode(node.type)
  );
}

function symbolDeclarationFiles(
  type: ts.Type
): string[] {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return (
    symbol?.declarations?.map(
      (declaration) =>
        declaration.getSourceFile().fileName
    ) ?? []
  );
}

function typeName(
  type: ts.Type,
  checker: ts.TypeChecker
): string {
  return (
    type.aliasSymbol?.getName() ??
    type.getSymbol()?.getName() ??
    checker.typeToString(type)
  );
}

interface TypeProvenanceContext {
  repository: ResolvedTypeScriptRepository;
  checker: ts.TypeChecker;
  scipIndex?: ScipIndex;
  typeAliasesByScipSymbol: Map<
    string,
    ts.TypeAliasDeclaration
  >;
}

function checkerTypeReferenceIsGenerated(
  node: ts.TypeReferenceNode,
  checker: ts.TypeChecker,
  generatedDirs: string[]
): boolean {
  let symbol = checker.getSymbolAtLocation(
    node.typeName
  );

  if (
    symbol &&
    (symbol.flags & ts.SymbolFlags.Alias) !== 0
  ) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  return (
    symbol?.declarations?.some((declaration) =>
      isInsideAny(
        declaration.getSourceFile().fileName,
        generatedDirs
      )
    ) ?? false
  );
}

function typeNodeReferencesGenerated(
  node: ts.TypeNode,
  context: TypeProvenanceContext,
  seen = new Set<string>()
): boolean {
  if (ts.isTypeReferenceNode(node)) {
    const symbol = scipSymbolForNode(
      node.typeName,
      context.repository,
      context.scipIndex
    );

    if (symbol && !seen.has(symbol)) {
      seen.add(symbol);

      const sourceFile =
        node.getSourceFile();
      const sourceRelative = relativeToRoot(
        sourceFile.fileName,
        context.repository.root
      );
      const definingDocument =
        context.scipIndex?.getDefiningDocument(
          symbol,
          sourceRelative
        );

      if (definingDocument) {
        const targetAbsolute = path.resolve(
          context.repository.root,
          definingDocument.relativePath
        );

        if (
          isInsideAny(
            targetAbsolute,
            context.repository.generatedRuntimeDirs
          )
        ) {
          return true;
        }

        const alias =
          context.typeAliasesByScipSymbol.get(
            symbol
          );

        if (
          alias &&
          typeNodeReferencesGenerated(
            alias.type,
            context,
            seen
          )
        ) {
          return true;
        }
      } else if (
        checkerTypeReferenceIsGenerated(
          node,
          context.checker,
          context.repository.generatedRuntimeDirs
        )
      ) {
        // scip-typescript can reference symbols from another
        // indexed project without embedding that project's
        // defining document. Keep the TypeScript checker only
        // for this cross-project provenance boundary.
        return true;
      }
    } else if (
      !symbol &&
      checkerTypeReferenceIsGenerated(
        node,
        context.checker,
        context.repository.generatedRuntimeDirs
      )
    ) {
      // Compatibility for incomplete/external SCIP evidence.
      return true;
    }
  }

  let found = false;
  node.forEachChild((child) => {
    if (!found && ts.isTypeNode(child)) {
      found = typeNodeReferencesGenerated(
        child,
        context,
        seen
      );
    }
  });
  return found;
}

function declarationTypeNode(
  declaration: ts.Declaration
): ts.TypeNode | undefined {
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isParameter(declaration) ||
    ts.isPropertyDeclaration(declaration)
  ) {
    return declaration.type;
  }
  return undefined;
}

function argumentHasContractProvenance(
  argument: ts.Expression,
  context: TypeProvenanceContext
): boolean {
  if (ts.isObjectLiteralExpression(argument)) {
    return true;
  }

  if (ts.isIdentifier(argument)) {
    const symbol =
      context.checker.getSymbolAtLocation(
        argument
      );
    const declarations = symbol?.declarations ?? [];
    let hasExplicitType = false;

    for (const declaration of declarations) {
      const typeNode =
        declarationTypeNode(declaration);

      if (!typeNode) continue;
      hasExplicitType = true;

      if (
        typeNodeReferencesGenerated(
          typeNode,
          context
        )
      ) {
        return true;
      }
    }

    if (
      declarations.some((declaration) =>
        declarationTypeNode(declaration) ===
        undefined
      )
    ) {
      return true;
    }

    if (hasExplicitType) {
      return false;
    }
  }

  const actualType =
    context.checker.getTypeAtLocation(argument);

  return symbolDeclarationFiles(actualType).some(
    (file) =>
      isInsideAny(
        file,
        context.repository.generatedRuntimeDirs
      )
  );
}

function sourceAllowedDirectHttp(
  file: string,
  repository: ResolvedTypeScriptRepository
): boolean {
  return (
    isInsideAny(
      file,
      repository.generatedRuntimeDirs
    ) ||
    isInsideAny(
      file,
      repository.allowDirectHttpDirs
    )
  );
}

function isExecutableFunction(
  node: ts.Node
): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function moduleScopeId(sourceFile: string): string {
  return `module:${sourceFile}`;
}

function functionScopeId(
  sourceFile: string,
  node: ts.Node
): string {
  return `function:${sourceFile}:${node.pos}`;
}

function addEdge(
  edges: Map<string, Set<string>>,
  source: string,
  target: string
): void {
  const targets = edges.get(source) ?? new Set<string>();
  targets.add(target);
  edges.set(source, targets);
}

function executableScopeForDeclaration(
  declaration: ts.Declaration,
  scopeIdByNode: Map<ts.Node, string>
): string | undefined {
  const direct = scopeIdByNode.get(declaration);
  if (direct) return direct;

  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    isExecutableFunction(declaration.initializer)
  ) {
    return scopeIdByNode.get(declaration.initializer);
  }

  if (
    ts.isPropertyDeclaration(declaration) &&
    declaration.initializer &&
    isExecutableFunction(declaration.initializer)
  ) {
    return scopeIdByNode.get(declaration.initializer);
  }

  let current: ts.Node | undefined =
    declaration.parent;
  while (current) {
    const scope = scopeIdByNode.get(current);
    if (scope) return scope;
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }

  return undefined;
}

function repositoryLocalCallableScope(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  scopeIdByNode: Map<ts.Node, string>,
  repository: ResolvedTypeScriptRepository
): string | undefined {
  if (isExecutableFunction(expression)) {
    return scopeIdByNode.get(expression);
  }

  const type = checker.getTypeAtLocation(expression);

  for (const signature of type.getCallSignatures()) {
    const declaration = signature.declaration;
    if (!declaration) continue;

    const targetAbsolute =
      declaration.getSourceFile().fileName;

    if (!isInside(targetAbsolute, repository.root)) {
      continue;
    }

    const scope = executableScopeForDeclaration(
      declaration,
      scopeIdByNode
    );
    if (scope) return scope;
  }

  return undefined;
}

function standardCallbackArgumentIndexes(
  call: ts.CallExpression,
  declaration: ts.Signature["declaration"]
): readonly number[] | undefined {
  if (!declaration) return undefined;

  const declarationFile = declaration.getSourceFile();
  const basename = path.basename(declarationFile.fileName);

  if (
    !declarationFile.isDeclarationFile ||
    !basename.startsWith("lib.")
  ) {
    return undefined;
  }

  if (ts.isPropertyAccessExpression(call.expression)) {
    return STANDARD_CALLBACK_METHODS.get(
      call.expression.name.text
    );
  }

  if (ts.isIdentifier(call.expression)) {
    return STANDARD_CALLBACK_FUNCTIONS.get(
      call.expression.text
    );
  }

  return undefined;
}

function methodScopeFromType(
  type: ts.Type,
  methodName: string,
  location: ts.Node,
  checker: ts.TypeChecker,
  scopeIdByNode: Map<ts.Node, string>,
  repository: ResolvedTypeScriptRepository
): string | undefined {
  const property = type.getProperty(methodName);
  if (!property) return undefined;

  const propertyType =
    checker.getTypeOfSymbolAtLocation(
      property,
      location
    );

  for (const signature of propertyType.getCallSignatures()) {
    const declaration = signature.declaration;
    if (!declaration) continue;

    const targetAbsolute =
      declaration.getSourceFile().fileName;

    if (!isInside(targetAbsolute, repository.root)) {
      continue;
    }

    const scope = executableScopeForDeclaration(
      declaration,
      scopeIdByNode
    );
    if (scope) return scope;
  }

  return undefined;
}

function concreteReceiverMethodScope(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  scopeIdByNode: Map<ts.Node, string>,
  repository: ResolvedTypeScriptRepository
): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }

  const receiver = call.expression.expression;
  if (!ts.isIdentifier(receiver)) {
    return undefined;
  }

  const symbol = checker.getSymbolAtLocation(receiver);
  const declarations = symbol?.declarations ?? [];

  for (const declaration of declarations) {
    if (
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      !ts.isNewExpression(declaration.initializer)
    ) {
      continue;
    }

    const concreteType =
      checker.getTypeAtLocation(
        declaration.initializer
      );

    const scope = methodScopeFromType(
      concreteType,
      call.expression.name.text,
      declaration.initializer,
      checker,
      scopeIdByNode,
      repository
    );

    if (scope) return scope;
  }

  return undefined;
}

function declaredInterfaceType(
  declaration: ts.Signature["declaration"],
  checker: ts.TypeChecker
): ts.Type | undefined {
  if (
    !declaration ||
    !ts.isMethodSignature(declaration) ||
    !ts.isInterfaceDeclaration(declaration.parent)
  ) {
    return undefined;
  }

  const symbol = checker.getSymbolAtLocation(
    declaration.parent.name
  );

  return symbol
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : undefined;
}

function interfaceImplementationScopes(
  declaration: ts.Signature["declaration"],
  methodName: string,
  checker: ts.TypeChecker,
  scopeIdByNode: Map<ts.Node, string>,
  repository: ResolvedTypeScriptRepository,
  classDeclarations: ts.ClassDeclaration[]
): Set<string> {
  const interfaceType =
    declaredInterfaceType(
      declaration,
      checker
    );
  if (!interfaceType) return new Set();

  const result = new Set<string>();

  for (const classDeclaration of classDeclarations) {
    if (!classDeclaration.name) continue;

    const symbol = checker.getSymbolAtLocation(
      classDeclaration.name
    );
    if (!symbol) continue;

    const classType =
      checker.getDeclaredTypeOfSymbol(symbol);

    if (
      !checker.isTypeAssignableTo(
        classType,
        interfaceType
      )
    ) {
      continue;
    }

    const scope = methodScopeFromType(
      classType,
      methodName,
      classDeclaration,
      checker,
      scopeIdByNode,
      repository
    );

    if (scope) result.add(scope);
  }

  return result;
}

function scopeCanReachHttp(
  startScope: string,
  callEdges: Map<string, Set<string>>,
  callsByScope: Map<string, HttpCallRecord[]>
): boolean {
  const queue = [startScope];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if ((callsByScope.get(current) ?? []).length > 0) {
      return true;
    }

    for (const target of callEdges.get(current) ?? []) {
      queue.push(target);
    }
  }

  return false;
}

function compactFilePath(
  scopeIds: string[],
  scopes: Map<string, ExecutableScope>
): string[] {
  const files: string[] = [];

  for (const scopeId of scopeIds) {
    const file = scopes.get(scopeId)?.sourceFile;
    if (!file) continue;
    if (files[files.length - 1] !== file) {
      files.push(file);
    }
  }

  return files;
}

export async function analyzeTypeScriptRepository(
  repository: ResolvedTypeScriptRepository,
  analysisOptions: TypeScriptAnalysisOptions = {}
): Promise<AnalysisResult> {
  const files = await walk(repository.sourceDir);
  const fileSet = new Set(
    files.map((file) => path.resolve(file))
  );
  const options = compilerOptions(repository);
  const program = ts.createProgram({
    rootNames: files,
    options: { ...options, noEmit: true }
  });
  const checker = program.getTypeChecker();

  const facts: Fact[] = [];
  const httpCalls: HttpCallRecord[] = [];
  const scopeIdByNode = new Map<ts.Node, string>();
  const scopes = new Map<string, ExecutableScope>();
  const rootScopesByFile = new Map<
    string,
    Set<string>
  >();
  const callEdges = new Map<
    string,
    Set<string>
  >();
  const classDeclarations: ts.ClassDeclaration[] = [];
  const dynamicDispatches: DynamicDispatchRecord[] = [];
  let unresolvedInternalImports = 0;
  let unresolvedCallbackFlows = 0;

  for (const absoluteFile of files) {
    const sourceFile =
      program.getSourceFile(absoluteFile);
    if (!sourceFile) continue;

    const sourceRelative = relativeToRoot(
      absoluteFile,
      repository.root
    );
    const generated = isInsideAny(
      absoluteFile,
      repository.generatedRuntimeDirs
    );
    const moduleId = moduleScopeId(sourceRelative);

    scopes.set(moduleId, {
      id: moduleId,
      sourceFile: sourceRelative,
      sourceAbsolute: absoluteFile,
      generated
    });
    rootScopesByFile.set(
      sourceRelative,
      new Set([moduleId])
    );

    const registerScopes = (
      node: ts.Node,
      enclosingFunction: string | undefined
    ): void => {
      let nextEnclosing = enclosingFunction;

      if (ts.isClassDeclaration(node)) {
        classDeclarations.push(node);
      }

      if (isExecutableFunction(node)) {
        const id = functionScopeId(
          sourceRelative,
          node
        );
        scopeIdByNode.set(node, id);
        scopes.set(id, {
          id,
          sourceFile: sourceRelative,
          sourceAbsolute: absoluteFile,
          generated
        });

        if (!enclosingFunction) {
          rootScopesByFile
            .get(sourceRelative)
            ?.add(id);
        }

        nextEnclosing = id;
      }

      ts.forEachChild(node, (child) =>
        registerScopes(
          child,
          nextEnclosing
        )
      );
    };

    registerScopes(sourceFile, undefined);
  }

  for (const absoluteFile of files) {
    const sourceFile =
      program.getSourceFile(absoluteFile);
    if (!sourceFile) continue;

    const sourceRelative = relativeToRoot(
      absoluteFile,
      repository.root
    );
    const generated = isInsideAny(
      absoluteFile,
      repository.generatedRuntimeDirs
    );
    const directHttpAllowed =
      sourceAllowedDirectHttp(
        absoluteFile,
        repository
      );
    const moduleId = moduleScopeId(sourceRelative);

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(
          statement.moduleSpecifier
        )
      ) {
        continue;
      }

      const specifier =
        statement.moduleSpecifier.text;

      const scipRange =
        analysisOptions.scipIndex
          ? moduleSpecifierScipRange(
              sourceFile,
              statement.moduleSpecifier
            )
          : undefined;
      const scipResolution =
        analysisOptions.scipIndex && scipRange
          ? resolveTypeScriptModuleSpecifierWithScip(
              analysisOptions.scipIndex,
              sourceRelative,
              scipRange
            )
          : undefined;

      const targetFile =
        scipResolution?.targetFile;
      const targetAbsolute = targetFile
        ? path.resolve(
            repository.root,
            targetFile
          )
        : undefined;
      const resolved =
        scipResolution?.resolved ?? false;
      const internal =
        !!targetAbsolute &&
        isInside(
          targetAbsolute,
          repository.root
        );

      if (
        specifier.startsWith(".") &&
        !resolved
      ) {
        unresolvedInternalImports += 1;
      }

      facts.push({
        kind: "module-dependency",
        repositoryId: repository.id,
        source:
          `${sourceRelative}:${location(
            sourceFile,
            statement
          )}`,
        sourceFile: sourceRelative,
        specifier,
        targetFile: targetFile ?? "",
        resolved,
        internal
      });

      if (
        targetAbsolute &&
        internal &&
        fileSet.has(
          path.resolve(targetAbsolute)
        ) &&
        targetFile
      ) {
        addEdge(
          callEdges,
          moduleId,
          moduleScopeId(targetFile)
        );
      }
    }

    const visit = (
      node: ts.Node,
      currentScopeId: string
    ): void => {
      let scopeId = currentScopeId;

      if (isExecutableFunction(node)) {
        scopeId =
          scopeIdByNode.get(node) ??
          currentScopeId;
      }

      const source =
        `${sourceRelative}:${location(
          sourceFile,
          node
        )}`;

      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node)
      ) {
        const name = node.name?.text;
        if (name) {
          facts.push({
            kind: "type-declaration",
            repositoryId: repository.id,
            source,
            sourceFile: sourceRelative,
            name,
            declarationKind:
              declarationKind(node),
            definesShape:
              ts.isTypeAliasDeclaration(node)
                ? aliasDefinesShape(node)
                : true,
            sourceGenerated: generated
          });
        }
      }

      if (ts.isCallExpression(node)) {
        let transport: string | undefined;
        let method: string | undefined;
        let requestPath: string | undefined;

        const transportBinding =
          resolveTransportExpression(
            node.expression,
            checker,
            repository,
            analysisOptions.scipIndex
          );

        if (
          transportBinding &&
          !isTransportFactory(transportBinding)
        ) {
          transport = transportBinding.module;

          if (transport === "fetch") {
            method = fetchMethod(node);
            requestPath = staticPath(
              node.arguments[0]
            );
          } else {
            const candidate =
              transportBinding.importedName
                ?.toLowerCase();

            if (
              candidate &&
              HTTP_METHODS.has(candidate)
            ) {
              method = candidate.toUpperCase();
              requestPath = staticPath(
                node.arguments[0]
              );
            } else if (
              node.arguments[0] &&
              ts.isObjectLiteralExpression(
                node.arguments[0]
              )
            ) {
              const config = node.arguments[0];
              method = (
                stringValue(
                  objectProperty(config, "method")
                ) ?? "GET"
              ).toUpperCase();
              requestPath = staticPath(
                objectProperty(config, "url")
              );
            }
          }
        }

        if (transport) {
          const knownOperation =
            !!method &&
            requestPath !== undefined;
          const fact: Fact = {
            kind: "http-call",
            repositoryId: repository.id,
            source,
            sourceFile: sourceRelative,
            transport,
            method: method ?? "",
            path: requestPath ?? "",
            operationKey: knownOperation
              ? operationKey(
                  method!,
                  requestPath!
                )
              : "",
            operationKeyKnown: knownOperation,
            sourceGenerated: generated,
            directHttpAllowed
          };
          facts.push(fact);
          httpCalls.push({
            fact,
            sourceFile: sourceRelative,
            sourceAbsolute: absoluteFile,
            scopeId
          });
        }

        const signature =
          checker.getResolvedSignature(node);
        const declaration =
          signature?.declaration;

        const callbackIndexes =
          standardCallbackArgumentIndexes(
            node,
            declaration
          );
        const knownCallbackIndexes =
          new Set(callbackIndexes ?? []);

        for (
          let index = 0;
          index < node.arguments.length;
          index += 1
        ) {
          const callbackScope =
            repositoryLocalCallableScope(
              node.arguments[index]!,
              checker,
              scopeIdByNode,
              repository
            );

          if (!callbackScope) continue;

          if (knownCallbackIndexes.has(index)) {
            addEdge(
              callEdges,
              scopeId,
              callbackScope
            );
          } else {
            unresolvedCallbackFlows += 1;
          }
        }

        let resolvedTargetScope:
          | string
          | undefined;

        if (declaration) {
          const targetAbsolute =
            declaration.getSourceFile().fileName;
          if (
            isInside(
              targetAbsolute,
              repository.root
            )
          ) {
            resolvedTargetScope =
              executableScopeForDeclaration(
                declaration,
                scopeIdByNode
              );

            if (resolvedTargetScope) {
              addEdge(
                callEdges,
                scopeId,
                resolvedTargetScope
              );
            }
          }
        }

        if (
          !resolvedTargetScope &&
          ts.isPropertyAccessExpression(node.expression)
        ) {
          const concreteScope =
            concreteReceiverMethodScope(
              node,
              checker,
              scopeIdByNode,
              repository
            );

          if (concreteScope) {
            addEdge(
              callEdges,
              scopeId,
              concreteScope
            );
          } else {
            const candidates =
              interfaceImplementationScopes(
                declaration,
                node.expression.name.text,
                checker,
                scopeIdByNode,
                repository,
                classDeclarations
              );

            if (candidates.size > 0) {
              dynamicDispatches.push({
                candidateScopes: candidates
              });
            }
          }
        }

        if (signature && declaration) {
          const targetAbsolute =
            declaration.getSourceFile().fileName;
          if (
            isInsideAny(
              targetAbsolute,
              repository.generatedRuntimeDirs
            )
          ) {
            const parameters =
              signature.getParameters();
            for (
              let index = 0;
              index < node.arguments.length &&
              index < parameters.length;
              index += 1
            ) {
              const parameter =
                parameters[index]!;
              const expectedType =
                checker.getTypeOfSymbolAtLocation(
                  parameter,
                  declaration
                );
              const expectedGenerated =
                symbolDeclarationFiles(
                  expectedType
                ).some((file) =>
                  isInsideAny(
                    file,
                    repository.generatedRuntimeDirs
                  )
                );

              if (!expectedGenerated) {
                continue;
              }

              const argument =
                node.arguments[index]!;
              const actualType =
                checker.getTypeAtLocation(argument);

              facts.push({
                kind: "api-boundary-type",
                repositoryId: repository.id,
                source,
                sourceFile: sourceRelative,
                targetFile: relativeToRoot(
                  targetAbsolute,
                  repository.root
                ),
                argumentIndex: index,
                expectedType: typeName(
                  expectedType,
                  checker
                ),
                actualType: typeName(
                  actualType,
                  checker
                ),
                contractTypeProvenance:
                  argumentHasContractProvenance(
                    argument,
                    checker,
                    repository.generatedRuntimeDirs
                  )
              });
            }
          }
        }
      }

      ts.forEachChild(node, (child) =>
        visit(child, scopeId)
      );
    };

    visit(sourceFile, moduleId);
  }

  const callsByScope = new Map<
    string,
    HttpCallRecord[]
  >();
  for (const call of httpCalls) {
    const current =
      callsByScope.get(call.scopeId) ?? [];
    current.push(call);
    callsByScope.set(
      call.scopeId,
      current
    );
  }

  let unresolvedDynamicHttpDispatches = 0;

  for (const dispatch of dynamicDispatches) {
    if (
      [...dispatch.candidateScopes].some(
        (scopeId) =>
          scopeCanReachHttp(
            scopeId,
            callEdges,
            callsByScope
          )
      )
    ) {
      unresolvedDynamicHttpDispatches += 1;
    }
  }

  for (const sourceAbsolute of files) {
    const sourceFile = relativeToRoot(
      sourceAbsolute,
      repository.root
    );
    const sourceDirectHttpAllowed =
      sourceAllowedDirectHttp(
        sourceAbsolute,
        repository
      );
    const emitted = new Set<string>();

    for (const rootScopeId of
      rootScopesByFile.get(sourceFile) ?? []) {
      const rootScope = scopes.get(
        rootScopeId
      );
      if (!rootScope) continue;

      const queue: Array<{
        scopeId: string;
        path: string[];
        generated: boolean;
      }> = [
        {
          scopeId: rootScopeId,
          path: [rootScopeId],
          generated: rootScope.generated
        }
      ];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        const stateKey =
          `${current.scopeId}|${current.generated}`;
        if (visited.has(stateKey)) continue;
        visited.add(stateKey);

        const currentScope =
          scopes.get(current.scopeId);
        if (!currentScope) continue;

        const filePath = compactFilePath(
          current.path,
          scopes
        );
        const pathText = filePath.join(
          " -> "
        );

        for (const call of
          callsByScope.get(
            current.scopeId
          ) ?? []) {
          const key = [
            call.fact.source,
            current.generated,
            pathText
          ].join("|");
          if (emitted.has(key)) continue;
          emitted.add(key);

          facts.push({
            kind: "http-reach",
            repositoryId: repository.id,
            source: sourceFile,
            sourceFile,
            terminalFile:
              currentScope.sourceFile,
            transport: String(
              call.fact.transport
            ),
            operationKey: String(
              call.fact.operationKey
            ),
            operationKeyKnown: Boolean(
              call.fact.operationKeyKnown
            ),
            throughGeneratedRuntime:
              current.generated,
            sourceDirectHttpAllowed,
            path: pathText
          });
        }

        for (const targetScopeId of
          callEdges.get(
            current.scopeId
          ) ?? []) {
          const targetScope =
            scopes.get(targetScopeId);
          if (!targetScope) continue;

          queue.push({
            scopeId: targetScopeId,
            path: [
              ...current.path,
              targetScopeId
            ],
            generated:
              current.generated ||
              targetScope.generated
          });
        }
      }
    }
  }

  const importResolutionStatus =
    unresolvedInternalImports === 0
      ? "complete"
      : "partial";
  const importResolutionMessage =
    unresolvedInternalImports === 0
      ? undefined
      : `${unresolvedInternalImports} relative import(s) lack SCIP module resolution.`;

  const transportEvidenceStatus =
    analysisOptions.scipIndex
      ? "complete"
      : "partial";
  const transportEvidenceMessage =
    analysisOptions.scipIndex
      ? undefined
      : "SCIP index is required for TypeScript transport symbol identity.";

  const reachabilityIssues: string[] = [];

  if (!analysisOptions.scipIndex) {
    reachabilityIssues.push(
      "SCIP index is unavailable for transport symbol identity"
    );
  }

  if (unresolvedInternalImports > 0) {
    reachabilityIssues.push(
      `${unresolvedInternalImports} relative import(s) lack SCIP module resolution`
    );
  }

  if (unresolvedCallbackFlows > 0) {
    reachabilityIssues.push(
      `${unresolvedCallbackFlows} repository-local function value(s) were passed to calls with unknown callback execution semantics`
    );
  }

  if (unresolvedDynamicHttpDispatches > 0) {
    reachabilityIssues.push(
      `${unresolvedDynamicHttpDispatches} interface dispatch site(s) have HTTP-capable local implementations but no statically known concrete binding`
    );
  }

  const reachabilityStatus =
    reachabilityIssues.length === 0
      ? "complete"
      : "partial";
  const reachabilityMessage =
    reachabilityIssues.length === 0
      ? undefined
      : `${reachabilityIssues.join("; ")}; call reachability facts may be incomplete.`;

  const evidence: FactEvidence[] = [
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "http-call",
      status: transportEvidenceStatus,
      message: transportEvidenceMessage
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "type-declaration",
      status: "complete"
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "module-dependency",
      status: importResolutionStatus,
      message: importResolutionMessage
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "http-reach",
      status: reachabilityStatus,
      message: reachabilityMessage
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "api-boundary-type",
      status: importResolutionStatus,
      message: importResolutionMessage
    }
  ];

  return { facts, evidence };
}
