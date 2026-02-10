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
      '@coding-assistant/shared':      resolve(pkg('shared'), 'index.ts'),
      '@coding-assistant/core':        resolve(pkg('core'), 'index.ts'),
      '@coding-assistant/tools':       resolve(pkg('tools'), 'index.ts'),
      '@coding-assistant/providers':   resolve(pkg('providers'), 'index.ts'),
      '@coding-assistant/agents':      resolve(pkg('agents'), 'index.ts'),
      '@coding-assistant/permissions': resolve(pkg('permissions'), 'index.ts'),
      '@coding-assistant/config':      resolve(pkg('config'), 'index.ts'),
      '@coding-assistant/context':     resolve(pkg('context'), 'index.ts'),
      '@coding-assistant/persistence': resolve(pkg('persistence'), 'index.ts'),
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
