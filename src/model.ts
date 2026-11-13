export type OutputFormat = "text" | "json";

export interface ContractOperation {
  method: string;
  path: string;
  operationId: string;
}

export interface ContractCatalog {
  operations: ContractOperation[];
  operationIds: Set<string>;
  schemaNames: Set<string>;
}

export interface ResolvedPlConfig {
  root: string;
  sourceDir: string;
  generatedRuntimeDirs: string[];
  allowDirectHttpDirs: string[];
  allowManualContractTypeDirs: string[];
  httpModules: string[];
}

export interface ResolvedGateConfig {
  configFile: string;
  contractsFile: string;
  pl: ResolvedPlConfig;
  bhRoot?: string;
}

export interface RawGateConfig {
  repositories: {
    pl: {
      root: string;
      sourceDir?: string;
      generatedRuntimeDirs: string[];
      allowDirectHttpDirs?: string[];
      allowManualContractTypeDirs?: string[];
      httpModules?: string[];
    };
    apiContracts: {
      root: string;
      openapi: string;
    };
    bh?: {
      root: string;
    };
  };
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
    consumer: "pl" | string;
    provider: "bh" | string;
    operationId: string;
    via: string;
  }>;
  wireTypes?: Array<{
    consumer: "pl" | string;
    name: string;
    source: string;
  }>;
}
