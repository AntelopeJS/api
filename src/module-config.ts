import type { CorsConfig } from "@antelopejs/interface-api";

import { type Config, resolveServers } from "./server-config";

let conf: Config = {
  servers: [],
};

export function getConfig(): Config {
  return conf;
}

export function configure(config: Config): void {
  conf = {
    ...config,
    servers: resolveServers(config),
  };
}

export function setCorsConfig(cors: CorsConfig): void {
  conf = { ...conf, cors };
}
