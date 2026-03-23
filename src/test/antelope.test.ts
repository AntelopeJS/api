import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "api-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: {
      source: { type: "local", path: "." },
      config: {
        servers: [
          {
            protocol: "http",
            host: "127.0.0.1",
            port: 5010,
          },
        ],
      },
    },
  },
  test: {
    folder: "dist/test",
  },
});
