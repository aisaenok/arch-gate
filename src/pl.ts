import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { ContractCatalog, ResolvedPlConfig, Violation } from "./model.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isInsideAny(file: string, directories: string[]): boolean {
  return directories.some((directory) => isInside(file, directory));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }

  return files;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${line + 1}:${character + 1}`;
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export async function analyzePl(config: ResolvedPlConfig, contracts: ContractCatalog): Promise<Violation[]> {
  const files = await walk(config.sourceDir);
  const violations: Violation[] = [];

  for (const file of files) {
    const generated = isInsideAny(file, config.generatedRuntimeDirs);
    const directHttpAllowed = generated || isInsideAny(file, config.allowDirectHttpDirs);
    const manualContractTypeAllowed = generated || isInsideAny(file, config.allowManualContractTypeDirs);
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const relativeFile = relativeToRoot(file, config.root);

    const visit = (node: ts.Node): void => {
      if (!directHttpAllowed && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleName = node.moduleSpecifier.text;
        if (config.httpModules.includes(moduleName)) {
          violations.push({
            rule: "ARCH001",
            source: `${relativeFile}:${location(sourceFile, node)}`,
            target: moduleName,
            message: "PL must not use a direct HTTP transport outside generated runtime API.",
            details: { expected: "generated runtime API", actual: `direct import from ${moduleName}` }
          });
        }
      }

      if (!directHttpAllowed && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        violations.push({
          rule: "ARCH001",
          source: `${relativeFile}:${location(sourceFile, node)}`,
          target: "fetch",
          message: "PL must not use fetch directly outside generated runtime API.",
          details: { expected: "generated runtime API", actual: "direct fetch() call" }
        });
      }

      if (!directHttpAllowed && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "XMLHttpRequest") {
        violations.push({
          rule: "ARCH001",
          source: `${relativeFile}:${location(sourceFile, node)}`,
          target: "XMLHttpRequest",
          message: "PL must not use XMLHttpRequest directly outside generated runtime API.",
          details: { expected: "generated runtime API", actual: "direct XMLHttpRequest usage" }
        });
      }

      if (!manualContractTypeAllowed && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node))) {
        const name = node.name?.text;
        if (name && contracts.schemaNames.has(name)) {
          violations.push({
            rule: "ARCH002",
            source: `${relativeFile}:${location(sourceFile, node)}`,
            target: name,
            message: "A PL type duplicates the name of a wire schema owned by api-contracts.",
            details: {
              expected: `${name} generated from api-contracts`,
              actual: `manual ${ts.SyntaxKind[node.kind]} declaration`
            }
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}
