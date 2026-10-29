
import { defineConfig } from "vite";

export default defineConfig({
  base: "/test/",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets"
  }
});
