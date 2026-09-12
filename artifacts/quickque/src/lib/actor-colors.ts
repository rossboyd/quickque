import type { ActorCharacter } from './types.ts';

export const CHARACTER_COLORS = [
  { name: 'Periwinkle', value: '#818cf8' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Sky', value: '#38bdf8' },
  { name: 'Violet', value: '#c084fc' },
  { name: 'Lime', value: '#a3e635' },
  { name: 'Orange', value: '#fb923c' },
] as const;

export function isCharacterColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function getCharacterColor(character?: ActorCharacter): string {
  if (!character) return '#94a3b8';
  if (isCharacterColor(character.accentColor)) return character.accentColor;
  // Names survive imported identity remapping, so legacy casts keep their cues.
  const hash = Array.from(character.name).reduce((value, letter) =>
    (value * 31 + letter.codePointAt(0)!) >>> 0, 0);
  return CHARACTER_COLORS[hash % CHARACTER_COLORS.length].value;
}

export function nextCharacterColor(characters: ActorCharacter[]): string {
  const used = new Set(characters.map(character => getCharacterColor(character).toLowerCase()));
  return (CHARACTER_COLORS.find(color => !used.has(color.value)) ??
    CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length]).value;
}
