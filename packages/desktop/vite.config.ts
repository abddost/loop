import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const pkg = (name: string) => resolve(root, `packages/${name}/src`);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@coding-assistant/shared': resolve(root, 'packages/shared/index.ts'),
      '@coding-assistant/core':   resolve(pkg('core'), 'index.ts'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
