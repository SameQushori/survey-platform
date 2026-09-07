import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function removeLocalSecretsFromBuild(): Plugin {
  return {
    name: "vecta-remove-local-secrets-from-build",
    enforce: "post",
    closeBundle() {
      const workerOutput = resolve(process.cwd(), "dist", "vecta");
      if (!existsSync(workerOutput)) return;
      for (const name of readdirSync(workerOutput)) {
        if (name === ".dev.vars" || name.startsWith(".dev.vars.") || name === ".env" || name.startsWith(".env.")) {
          rmSync(resolve(workerOutput, name), { force: true });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "/",
  plugins: [react(), ...(mode === "test" ? [] : [cloudflare()]), removeLocalSecretsFromBuild()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          dnd: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          icons: ["@phosphor-icons/react"],
        },
      },
    },
  },
}));
