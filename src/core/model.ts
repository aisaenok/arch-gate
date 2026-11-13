export type OutputFormat = "text" | "json";
export type RepositoryType = "typescript" | "openapi" | "java";

export interface ContractOperation {
  method: string;
  path: string;
  operationId: string;
}

export interface ContractCatalog {
  repositoryId: string;
  operations: ContractOperation[];
  operationIds: Set<string>;
  schemaNames: Set<string>;
}

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

export interface ApiThroughGeneratedRuleConfig {
  consumerRole: string;
  providerRole: string;
  contractRole: string;
}

export interface WireTypesFromContractRuleConfig {
  consumerRole: string;
  contractRole: string;
}

export interface RawGateConfig {
  repositories: Record<string, RawRepositoryConfig>;
  rules?: {
    apiThroughGenerated?: ApiThroughGeneratedRuleConfig;
    wireTypesFromContract?: WireTypesFromContractRuleConfig;
  };
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
  rules: {
    apiThroughGenerated?: ApiThroughGeneratedRuleConfig;
    wireTypesFromContract?: WireTypesFromContractRuleConfig;
  };
}

export interface HttpUsage {
  repositoryId: string;
  source: string;
  target: string;
  kind: "module-import" | "fetch" | "xml-http-request";
  directHttpAllowed: boolean;
}

export interface DeclaredType {
  repositoryId: string;
  source: string;
  name: string;
  kind: "interface" | "type" | "class";
  manualContractTypeAllowed: boolean;
}

export interface TypeScriptFacts {
  repositoryId: string;
  httpUsages: HttpUsage[];
  declaredTypes: DeclaredType[];
}

export interface ArchitectureModel {
  repositories: Record<string, ResolvedRepository>;
  contracts: ContractCatalog[];
  typescript: TypeScriptFacts[];
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
