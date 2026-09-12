import assert from 'node:assert/strict';
import test from 'node:test';
import { getReaderSurfacePresentation } from './reader-surface.ts';

test('compact overlay uses a clear alpha-only surface at zero opacity', () => {
  const presentation = getReaderSurfacePresentation(true, 0);

  assert.equal(
    presentation.style.backgroundColor,
    'hsl(var(--background) / 0)',
  );
  assert.equal(presentation.style.borderColor, 'hsl(var(--border) / 0.5)');
  assert.match(presentation.className, /\bfixed\b/);
  assert.doesNotMatch(presentation.className, /backdrop-blur|backdrop-filter/);
});

test('compact overlay applies only the selected background alpha', () => {
  const presentation = getReaderSurfacePresentation(true, 45);

  assert.equal(
    presentation.style.backgroundColor,
    'hsl(var(--background) / 0.45)',
  );
  assert.doesNotMatch(presentation.className, /backdrop-blur|backdrop-filter/);
});

test('full reader remains an opaque full-height surface', () => {
  const presentation = getReaderSurfacePresentation(false, 0);

  assert.equal(
    presentation.style.backgroundColor,
    'hsl(var(--background) / 1)',
  );
  assert.equal(presentation.style.borderColor, 'transparent');
  assert.equal(presentation.className, 'h-[100dvh] w-full');
});