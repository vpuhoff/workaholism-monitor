import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: ["virtual-ubuntu"],
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: ["virtual-ubuntu"],
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Workaholism Monitor",
        short_name: "Monitor",
        description: "Работайте сосредоточенно. Отдыхайте вовремя.",
        lang: "ru",
        theme_color: "#080a09",
        background_color: "#080a09",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,task}"],
        navigateFallbackDenylist: [/^\/mediapipe\//, /^\/api(?:\/|$)/],
      },
    }),
  ],
});
