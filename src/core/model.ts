export type OutputFormat = "text" | "json";
export type RepositoryType = "typescript" | "openapi" | "java";
export type JavaFramework = "jax-rs";
export type RuleScope = "check" | "plan" | "both";
export type FactValue = string | number | boolean | null;
export type EvidenceStatus = "complete" | "partial" | "unavailable";
export type GateStatus = "pass" | "fail" | "partial";
export type RepositoryRelationDirection = "outgoing" | "incoming";
export type RepositoryRelationQuantifier = "any" | "all";

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
  sourceDirs?: string[];
  frameworks?: JavaFramework[];
}

export type RawRepositoryConfig =
  | RawTypeScriptRepository
  | RawOpenApiRepository
  | RawJavaRepository;

export interface RepositoryRelation {
  type: string;
  from: string;
  to: string;
}

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

export interface RepositoryRelationMatch {
  type: string;
  currentField: string;
  candidateField: string;
  direction?: RepositoryRelationDirection;
  quantifier?: RepositoryRelationQuantifier;
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
  repositoryRelation?: RepositoryRelationMatch;
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
  relations?: RepositoryRelation[];
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
  sourceDirs: string[];
  frameworks: JavaFramework[];
}

export type ResolvedRepository =
  | ResolvedTypeScriptRepository
  | ResolvedOpenApiRepository
  | ResolvedJavaRepository;

export interface ResolvedGateConfig {
  configFile: string;
  repositories: Record<string, ResolvedRepository>;
  relations: RepositoryRelation[];
  rules: RuleDefinition[];
}

export interface Fact {
  kind: string;
  [key: string]: FactValue;
}

export interface FactEvidence {
  repositoryId: string;
  producer: string;
  factKind: string;
  status: EvidenceStatus;
  message?: string;
}

export interface AnalysisResult {
  facts: Fact[];
  evidence: FactEvidence[];
}

export interface ArchitectureModel {
  repositories: Record<string, ResolvedRepository>;
  relations: RepositoryRelation[];
  facts: Fact[];
  evidence: FactEvidence[];
}

export interface Violation {
  rule: string;
  message: string;
  source?: string;
  target?: string;
  details?: Record<string, string>;
}

export interface CoverageGap {
  rule: string;
  fact: string;
  message: string;
  repositoryId?: string;
}

export interface EvaluationResult {
  status: GateStatus;
  violations: Violation[];
  gaps: CoverageGap[];
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
