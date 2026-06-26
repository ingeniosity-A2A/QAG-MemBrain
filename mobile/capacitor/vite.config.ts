import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Mark packages we don't use (we use llama-server instead)
      // as external so Vite doesn't try to bundle them
      external: [
        '@mlc-ai/web-llm',
        '@arrow-js/sandbox',
        'three',
        'gsap',
        '@duckdb/duckdb-wasm',
        'apache-arrow',
      ],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
