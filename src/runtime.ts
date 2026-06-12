import * as InterfaceCore from "@antelopejs/interface-core";

export interface ServerEndpoint {
  protocol: string;
  host: string;
  port: number;
}

interface RuntimeInfo {
  dev: boolean;
  projectPath: string;
  env: string;
}

interface RuntimeAwareCore {
  GetRuntimeInfo?: () => Promise<RuntimeInfo>;
  RegisterDevServer?: (
    name: string,
    endpoints: ServerEndpoint[],
  ) => Promise<void>;
}

const runtimeCore = InterfaceCore as unknown as RuntimeAwareCore;

export async function isDevRuntime(): Promise<boolean> {
  if (!runtimeCore.GetRuntimeInfo) {
    return false;
  }

  const runtimeInfo = await runtimeCore.GetRuntimeInfo();
  return runtimeInfo.dev;
}

export async function registerDevServer(
  name: string,
  endpoints: ServerEndpoint[],
): Promise<void> {
  if (!runtimeCore.RegisterDevServer) {
    return;
  }

  await runtimeCore.RegisterDevServer(name, endpoints);
}
