declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  /** PDF.js's in-process worker handler used by the extraction worker. */
  export const WorkerMessageHandler: {
    setup(handler: unknown, port: unknown): void;
  };
}

declare module 'virtual:quickque-pdf-resources' {
  export const cmaps: Record<string, string>;
  export const fonts: Record<string, string>;
}