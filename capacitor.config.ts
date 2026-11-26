import type { CapacitorConfig } from "@capacitor/cli";

// Нативная обёртка: внутри — собранный dist (Vite), API уходит на maestro-server.fly.dev.
const config: CapacitorConfig = {
  appId: "dev.maestro.app",
  appName: "Задачник Маэстро",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
