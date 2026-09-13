import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { readSiteConfigSync, basePathWithSlash } from './lib/server/content.js';

function stylesheetBeforeHydration() {
  return {
    name: 'quickque-stylesheet-before-hydration',
    enforce: 'post' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        const moduleTag = html.match(/    <script type="module"[^>]*><\/script>\n?/);
        const stylesheetTag = html.match(/    <link rel="stylesheet"[^>]*>\n?/);
        if (!moduleTag || !stylesheetTag || stylesheetTag.index < moduleTag.index) return html;

        const withoutStylesheet = html.slice(0, stylesheetTag.index) +
          html.slice(stylesheetTag.index + stylesheetTag[0].length);
        const updatedModuleIndex = withoutStylesheet.indexOf(moduleTag[0]);
        return withoutStylesheet.slice(0, updatedModuleIndex) +
          stylesheetTag[0] +
          withoutStylesheet.slice(updatedModuleIndex);
      }
    }
  };
}

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
      tailwindcss(),
      stylesheetBeforeHydration()
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