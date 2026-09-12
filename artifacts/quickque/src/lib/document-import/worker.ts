import { extractDocument } from './extract.ts';

interface ExtractionRequest {
  name: string;
  buffer: ArrayBuffer;
}

interface ExtractionResponse {
  ok: true;
  result: Awaited<ReturnType<typeof extractDocument>>;
}

interface ExtractionFailure {
  ok: false;
  error: string;
}

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<ExtractionRequest>) => void): void;
  postMessage(message: ExtractionResponse | ExtractionFailure): void;
};

scope.addEventListener('message', (event) => {
  void (async () => {
    try {
      const request = event.data;
      if (!request || typeof request.name !== 'string' || !(request.buffer instanceof ArrayBuffer)) {
        throw new Error('The local document reader received an invalid request.');
      }
      const result = await extractDocument(request.name, request.buffer);
      scope.postMessage({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'This document could not be read locally.';
      scope.postMessage({ ok: false, error: message });
    }
  })();
});

export {};