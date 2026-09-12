import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { pdfBudgetPlugin } from './scripts/pdf-budget.mjs';

export default defineConfig({
  base: './',
  optimizeDeps: { include: ['fflate', 'saxes'], exclude: ['pdfjs-dist'] },
  worker: { format: 'es', plugins: () => [pdfBudgetPlugin()] },
  plugins: [
    pdfBudgetPlugin(),
    react(),
    tailwindcss(),
    {
      name: 'quickque-desktop-local-assets',
      transformIndexHtml(html) {
        return html.replace(
          /\s*<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>/g,
          '',
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist-desktop'),
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: {
      strict: true,
    },
  },
});