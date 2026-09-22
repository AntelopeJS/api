import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "playground",
  modules: {
    playground: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["npx tsc"],
      },
      config: {
        apiPort: "${@api.API_PORT}",
        apiLocalBaseUrl: "${@api.API_LOCAL_BASE_URL}",
        apiPublicBaseUrl: "${@api.API_PUBLIC_BASE_URL}",
      },
    },
    api: {
      source: {
        type: "local",
        path: "..",
        installCommand: ["npx tsc"],
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: 5010,
          },
        ],
      },
    },
  },
});
