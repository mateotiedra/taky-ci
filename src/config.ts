import { resolveConfig, type ResolvedConfig, type ResolvedProjectConfig } from "./resolve-config.js";

let _config: ResolvedConfig;

export async function loadConfig(): Promise<ResolvedConfig> {
  _config = await resolveConfig();
  return _config;
}

export function getConfig(): ResolvedConfig {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}

export function getProject(teamKey: string): ResolvedProjectConfig | undefined {
  return _config.projectsByTeamKey.get(teamKey);
}
