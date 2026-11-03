import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/web" },
  server: {
    host: "localhost", port: 5173, strictPort: true,
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.wrangler/**", "**/.dev.vars*"] },
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
});
