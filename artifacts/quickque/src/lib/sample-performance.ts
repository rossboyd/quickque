import type { Script, ActorCharacter } from './types.ts';
import type { LocalVoice } from './scene-speech.ts';
import { generateId } from './utils.ts';

/** Transcribed only from the Matilda screenshot supplied by the user. */
export function createMatildaSample(voices: LocalVoice[] = [], now = Date.now(), idFactory = generateId): Script {
  const english = voices.filter(voice => voice.engine === 'turbo' && /^en(?:[-_]|$)/i.test(voice.language));
  const cast = [
    { name: 'Matilda', accentColor: '#c084fc' },
    { name: 'Miss Honey', accentColor: '#f59e0b' },
    { name: 'Nigel', accentColor: '#38bdf8' },
    { name: 'Lavender', accentColor: '#fb7185' },
  ];
  const characters: ActorCharacter[] = cast.map((character, index) => ({
    ...character, id: idFactory(), age: '', gender: '', style: '',
    voice: { engine: 'turbo', voiceId: index > 0 && english.length ? english[(index - 1) % english.length].id : '', rate: 1 },
  }));
  const turns = [
    { who: 'Nigel', content: 'Me, me, me, oooh, oooh, me, pick me miss, I can, mememememe—' },
    { who: 'Miss Honey', content: 'Very well, Nigel.', notes: 'After this line: NIGEL opens his mouth to speak, but nothing comes out.' },
    { who: 'Miss Honey', content: 'Yes, I think we’d better leave it there, Nigel, we don’t want you to burst a blood vessel on your first day.', notes: 'After this line: NIGEL droops on his desk.' },
    { who: 'Miss Honey', content: 'Lavender?' },
    { who: 'Lavender', content: 'Is the first word... tomato?' },
    { who: 'Miss Honey', content: 'Um, no. But tomato is a very good word.' },
    { who: 'Lavender', content: 'Yessss!' },
    { who: 'Miss Honey', content: 'Matilda?' },
    { who: 'Matilda', content: 'I can now read words.' },
    { who: 'Miss Honey', content: 'So Matilda, you can read words?' },
    { who: 'Matilda', content: 'Well, I needed to learn to read words so that I could read sentences because basically a sentence is just a big bunch of words. And if you can’t read sentences you’ve got no chance with books.' },
    { who: 'Miss Honey', content: 'And... have you read a whole book yourself?' },
    { who: 'Matilda', content: 'More than one. I love books. Last week I read quite a few.' },
    { who: 'Miss Honey', content: 'A few? What books did you read?' },
  ];
  return {
    id: idFactory(), title: 'Matilda · Classroom sample', purpose: 'performance', createdAt: now, updatedAt: now,
    actor: { enabled: true, characters, myRoleIds: [characters[0].id] },
    sections: turns.map((turn, index) => ({
      id: idFactory(), title: `${index + 1}. ${turn.who}`, content: turn.content,
      characterId: characters.find(character => character.name === turn.who)!.id,
       ...(turn.notes ? { notes: turn.notes, notesProvenance: 'writer' as const } : {}),
    })),
  };
}
