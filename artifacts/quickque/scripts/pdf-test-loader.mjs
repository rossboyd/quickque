import { registerHooks } from 'node:module';
import { guardPdfWorker, PDF_RESOURCES_ID, pdfResourcesModule } from './pdf-budget.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PDF_RESOURCES_ID) return { url: specifier, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === PDF_RESOURCES_ID) return { format: 'module', source: pdfResourcesModule(), shortCircuit: true };
    const result = nextLoad(url, context);
    if (url.endsWith('/pdfjs-dist/legacy/build/pdf.worker.mjs')) {
      return { ...result, source: guardPdfWorker(String(result.source)) };
    }
    return result;
  },
});