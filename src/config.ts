import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawGateConfig, ResolvedGateConfig } from "./model.js";

export async function loadConfig(configFile: string): Promise<ResolvedGateConfig> {
  const absoluteConfig = path.resolve(configFile);
  const configDir = path.dirname(absoluteConfig);
  const raw = JSON.parse(await readFile(absoluteConfig, "utf8")) as RawGateConfig;

  if (!raw.repositories?.pl || !raw.repositories?.apiContracts) {
    throw new Error("Config must define repositories.pl and repositories.apiContracts");
  }

  const plRoot = path.resolve(configDir, raw.repositories.pl.root);
  const contractsRoot = path.resolve(configDir, raw.repositories.apiContracts.root);
  const bhRoot = raw.repositories.bh
    ? path.resolve(configDir, raw.repositories.bh.root)
    : undefined;

  return {
    configFile: absoluteConfig,
    contractsFile: path.resolve(contractsRoot, raw.repositories.apiContracts.openapi),
    pl: {
      root: plRoot,
      sourceDir: path.resolve(plRoot, raw.repositories.pl.sourceDir ?? "src"),
      generatedRuntimeDirs: raw.repositories.pl.generatedRuntimeDirs.map((dir) => path.resolve(plRoot, dir)),
      allowDirectHttpDirs: (raw.repositories.pl.allowDirectHttpDirs ?? []).map((dir) => path.resolve(plRoot, dir)),
      allowManualContractTypeDirs: (raw.repositories.pl.allowManualContractTypeDirs ?? []).map((dir) => path.resolve(plRoot, dir)),
      httpModules: raw.repositories.pl.httpModules ?? ["axios"]
    },
    bhRoot
  };
}
