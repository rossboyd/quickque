import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { readSiteConfigSync, basePathWithSlash } from './lib/server/content.js';

export default defineConfig(() => {
  // site.json is the single source of truth for both the server and Vite.
  // Reading it here also makes malformed or unverified release config fail
  // before either client or SSR output is written.
  const siteConfig = readSiteConfigSync(process.cwd());
  const basePath = basePathWithSlash(siteConfig.basePath);

  return {
    base: basePath,
    server: { host: '0.0.0.0', allowedHosts: true },
    plugins: [
      react(),
      tailwindcss()
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      emptyOutDir: true,
      copyPublicDir: true,
    }
  };
});