import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('dark theme retains the midnight navy and periwinkle reference palette', () => {
  const block = css.split('.dark {')[1].split('}')[0];
  assert.match(block, /--background: 222 47% 8%/);
  assert.match(block, /--card: 222 38% 12%/);
  assert.match(block, /--sidebar: 222 52% 7%/);
  assert.match(block, /--primary: 234 78% 70%/);
});

function luminance(block: string, token: string): number {
  const values = block.match(new RegExp(`--${token}: ([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
  assert.ok(values, `Missing HSL token ${token}`);
  const hue = Number(values[1]) / 60;
  const saturation = Number(values[2]) / 100;
  const lightness = Number(values[3]) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(hue % 2 - 1));
  const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0]
    : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma]
      : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.reduce((sum, value, index) => {
    const channel = value + lightness - chroma / 2;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

for (const theme of [':root', '.dark']) {
  test(`${theme} base text, action, error and focus tokens remain readable`, () => {
    const block = css.split(`${theme} {`)[1].split('}')[0];
    const pairs: Array<[string, string, number]> = [
      ['foreground', 'background', 4.5],
      ['primary', 'primary-foreground', 4.5],
      ['primary', 'background', 4.5],
      ['muted-foreground', 'background', 4.5],
      ['muted-foreground', 'muted', 4.5],
      ['destructive', 'destructive-foreground', 4.5],
      ['destructive', 'background', 4.5],
      ['ring', 'background', 3],
    ];
    for (const [a, b, minimum] of pairs) {
      const [dark, light] = [luminance(block, a), luminance(block, b)].sort((a, b) => a-b);
      const ratio = (light + 0.05) / (dark + 0.05);
      assert.ok(ratio >= minimum, `${a}/${b}: ${ratio.toFixed(2)}:1 must be >=${minimum}:1`);
    }
  });
}