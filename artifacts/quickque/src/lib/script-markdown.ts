import type { ActorCharacter, Script, ScriptSection } from './types.ts';
import { cloneActor, MAX_ACTOR_CHARACTERS } from './actor-model.ts';
import { nextCharacterColor } from './actor-colors.ts';
import { generateId } from './utils.ts';
import { MAX_SECTIONS, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } from './store-persistence.ts';

const speakerPattern = /^\*\*(.+):\*\*(?:[ \t]+(.*))?$/;
const structural = /^(?:\\|#{1,2}(?:\s|$)|>|\*\*.+:\*\*)/;
const label = (value: string) => /[\r\n]/.test(value) || value.trim() !== value || value.startsWith('"') ? JSON.stringify(value) : value;
const unlabel = (value: string) => value.startsWith('"') ? JSON.parse(value) as string : value.trim();
const escapeLine = (value: string) => structural.test(value) ? `\\${value}` : value;

export function scriptToMarkdown(script: Script): string {
  return [`# ${label(script.title)}`, '', ...script.sections.map(section => {
    const character = script.actor?.characters.find(item => item.id === section.characterId);
    return [
      `## ${label(section.title)}`,
      ...(character ? [`**${label(character.name)}:**`] : []),
      ...(section.notes !== undefined ? section.notes.split('\n').map(line => `> ${line}`) : []),
      '',
      section.content.split('\n').map(escapeLine).join('\n'),
    ].join('\n');
  })].join('\n');
}

type TurnDraft = { title: string; characterId?: string; body: string[]; notes: string[]; contentStarted: boolean };

type MarkdownResult = { ok: true; updates: Partial<Script>; newCharacters: string[] } | { ok: false; error: string };

/** A plain-text authoring format, never HTML/Markdown rendering or execution. */
export function parseScriptMarkdown(source: string, script: Script, idFactory = generateId): MarkdownResult {
  if (source.length > 8_000_000) return { ok: false, error: 'Markdown is too large. Keep the draft under 8 million characters.' };
  const actor = script.actor ? cloneActor(script.actor) : { enabled: true, characters: [], myRoleIds: [] };
  const newCharacters: string[] = [];
  const sections: ScriptSection[] = [];
  const usedIds = new Set<string>();
  let title = script.title;
  let titleSeen = false;
  let current: TurnDraft | null = null;
  let hasSpeakers = false;
  let lineNumber = 0;
  const readLabel = (value: string, kind: string, nonEmpty = false): string => {
    const parsed = unlabel(value);
    if (typeof parsed !== 'string' || parsed.length > MAX_TITLE_LENGTH || (nonEmpty && !parsed.trim())) {
      throw new Error(`${kind} must ${nonEmpty ? 'have a name and ' : ''}be at most ${MAX_TITLE_LENGTH} characters.`);
    }
    return parsed;
  };
  const start = (name?: string) => {
    current = { title: name ?? `Turn ${sections.length + 1}`, body: [], notes: [], contentStarted: false };
  };
  const flush = () => {
    if (!current) return;
    if (sections.length >= MAX_SECTIONS) throw new Error(`Use at most ${MAX_SECTIONS} sections or turns.`);
    const content = current.body.join('\n');
    const notes = current.notes.join('\n');
    if (content.length > MAX_CONTENT_LENGTH || notes.length > MAX_CONTENT_LENGTH) throw new Error('A turn or its notes exceeds 500,000 characters. Split it into smaller turns.');
    const previous = script.sections.find(item => !usedIds.has(item.id) && item.title === current!.title)
      ?? (script.sections[sections.length] && !usedIds.has(script.sections[sections.length].id) ? script.sections[sections.length] : undefined);
    const id = previous?.id ?? idFactory();
    usedIds.add(id);
    sections.push({ id, title: current.title, content,
      ...(current.notes.length ? { notes } : {}),
      ...(current.characterId ? { characterId: current.characterId } : previous?.characterId !== undefined ? { characterId: null } : {}),
    });
    current = null;
  };
  try {
    for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
      lineNumber++;
      if (line.startsWith('# ') || line === '#') {
        if (titleSeen || current || sections.length) throw new Error('Put the script title (#) once at the top. Use ## for sections; prefix a literal # with a backslash.');
        title = readLabel(line.slice(2), 'Script title'); titleSeen = true; continue;
      }
      if (line.startsWith('## ') || line === '##') {
        flush(); start(readLabel(line.slice(3), 'Section title')); continue;
      }
      const speaker = line.match(speakerPattern);
      if (speaker) {
        const name = readLabel(speaker[1], 'Character', true);
        const matches = actor.characters.filter(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (matches.length > 1) throw new Error(`More than one character is named ${name}. Give each character a unique name in cast setup.`);
        let character: ActorCharacter | undefined = matches[0];
        if (!character) {
          if (actor.characters.length >= MAX_ACTOR_CHARACTERS) throw new Error('Use at most 100 characters.');
          character = { id: idFactory(), name, accentColor: nextCharacterColor(actor.characters), age: '', gender: '', style: '', voice: { engine: 'turbo', voiceId: '', rate: 1 } };
          actor.characters.push(character); newCharacters.push(name);
        }
        const active = current as TurnDraft | null;
        if (active && (active.characterId || active.body.length)) flush();
        if (!current) start();
        current!.characterId = character.id; hasSpeakers = true;
        if (speaker[2] !== undefined) { current!.body.push(speaker[2]); current!.contentStarted = true; }
        continue;
      }
      if (!current && !line.trim()) continue;
      if (!current) start(script.sections[0]?.title ?? 'Section 1');
      if (line.startsWith('>')) {
        current!.notes.push(line.slice(line.startsWith('> ') ? 2 : 1)); continue;
      }
      // One blank line separates metadata from dialogue in the canonical format.
      if (!current!.contentStarted && line === '') { current!.contentStarted = true; continue; }
      current!.contentStarted = true;
      current!.body.push(line.startsWith('\\') && structural.test(line.slice(1)) ? line.slice(1) : line);
    }
    flush();
    if (!sections.length) return { ok: false, error: 'Add a section with ## or write some dialogue before saving.' };
    return { ok: true, newCharacters, updates: { title, sections,
      ...(hasSpeakers || script.actor ? { actor } : {}),
      ...(hasSpeakers && !script.sections.some(section => section.characterId) ? { purpose: 'performance' } : {}),
    } };
  } catch (error) {
    return { ok: false, error: `Line ${lineNumber}: ${error instanceof Error ? error.message : 'Check the markup.'}` };
  }
}
