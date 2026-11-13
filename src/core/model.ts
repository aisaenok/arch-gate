export type OutputFormat = "text" | "json";
export type RepositoryType = "typescript" | "openapi" | "java";
export type RuleScope = "check" | "plan" | "both";
export type FactValue = string | number | boolean | null;

interface RawRepositoryBase {
  type: RepositoryType;
  root: string;
  roles: string[];
}

export interface RawTypeScriptRepository extends RawRepositoryBase {
  type: "typescript";
  sourceDir?: string;
  generatedRuntimeDirs?: string[];
  allowDirectHttpDirs?: string[];
  allowManualContractTypeDirs?: string[];
  httpModules?: string[];
}

export interface RawOpenApiRepository extends RawRepositoryBase {
  type: "openapi";
  openapi: string;
}

export interface RawJavaRepository extends RawRepositoryBase {
  type: "java";
}

export type RawRepositoryConfig =
  | RawTypeScriptRepository
  | RawOpenApiRepository
  | RawJavaRepository;

export interface RepositoryRoleSelector {
  field: string;
  role: string;
}

export interface EqualitySelector {
  field: string;
  equals: FactValue;
}

export interface RuleSelector {
  fact: string;
  repositoryRoles?: RepositoryRoleSelector[];
  where?: EqualitySelector[];
}

export interface MemberOfSelector {
  fact: string;
  field: string;
  repositoryRoles?: RepositoryRoleSelector[];
  where?: EqualitySelector[];
  repositoryMatch?: {
    sourceField: string;
    currentField: string;
  };
}

export interface RuleCondition {
  field: string;
  equals?: FactValue;
  hasRole?: string;
  repositoryExists?: boolean;
  memberOf?: MemberOfSelector;
  not?: boolean;
  message?: string;
}

export interface RuleDefinition {
  id: string;
  description: string;
  scope?: RuleScope;
  select: RuleSelector;
  assert: RuleCondition[];
  sourceField?: string;
  targetField?: string;
}

export interface RawGateConfig {
  repositories: Record<string, RawRepositoryConfig>;
  rules: RuleDefinition[];
}

interface ResolvedRepositoryBase {
  id: string;
  type: RepositoryType;
  root: string;
  roles: string[];
}

export interface ResolvedTypeScriptRepository extends ResolvedRepositoryBase {
  type: "typescript";
  sourceDir: string;
  generatedRuntimeDirs: string[];
  allowDirectHttpDirs: string[];
  allowManualContractTypeDirs: string[];
  httpModules: string[];
}

export interface ResolvedOpenApiRepository extends ResolvedRepositoryBase {
  type: "openapi";
  openapiFile: string;
}

export interface ResolvedJavaRepository extends ResolvedRepositoryBase {
  type: "java";
}

export type ResolvedRepository =
  | ResolvedTypeScriptRepository
  | ResolvedOpenApiRepository
  | ResolvedJavaRepository;

export interface ResolvedGateConfig {
  configFile: string;
  repositories: Record<string, ResolvedRepository>;
  rules: RuleDefinition[];
}

export interface Fact {
  kind: string;
  [key: string]: FactValue;
}

export interface ArchitectureModel {
  repositories: Record<string, ResolvedRepository>;
  facts: Fact[];
}

export interface Violation {
  rule: string;
  message: string;
  source?: string;
  target?: string;
  details?: Record<string, string>;
}

export interface ArchitectureIntent {
  apiCalls?: Array<{
    consumer: string;
    provider: string;
    operationId: string;
    via: string;
  }>;
  wireTypes?: Array<{
    consumer: string;
    name: string;
    source: string;
  }>;
}
