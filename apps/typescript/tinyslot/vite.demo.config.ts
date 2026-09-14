import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./demo", import.meta.url)),
  base: "/tinyslot-demo/",
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./demo-dist", import.meta.url)),
    emptyOutDir: true,
  },
});
