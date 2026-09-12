import type { Script } from '@/lib/types';
import { getCharacterColor } from '@/lib/actor-colors';

/** Stays outside the scrolling dialogue and fading transport controls. */
export function SceneCues({ script, turnIndex, phase, silent, transform }: {
  script: Script;
  turnIndex: number;
  phase: string;
  silent: boolean;
  transform?: string;
}) {
  const cast = script.actor?.characters ?? [];
  const inPerson = script.actor?.myRoleIds ?? [];
  const completed = phase === 'completed';
  const current = completed ? undefined : script.sections[turnIndex];
  const next = completed ? undefined : script.sections[turnIndex + 1];
  const character = cast.find(item => item.id === current?.characterId);
  const nextCharacter = cast.find(item => item.id === next?.characterId);
  const mine = !!character && inPerson.includes(character.id);
  const status = !character ? 'Assign a character in setup'
    : mine ? 'Your turn · speak in person'
    : silent ? 'Silent cues · read this line in person'
    : phase === 'speaking' ? 'Speaking'
    : phase === 'preparing' ? 'Preparing voice…'
    : phase === 'error' ? 'Playback needs attention'
    : phase === 'paused' ? 'Paused'
    : 'Ready to speak';

  return <section aria-label="Rehearsal cues" className="scene-cues relative z-30 shrink-0 border-y border-border bg-background text-foreground">
    <div style={{ transform }}>
      <p className="scene-cast-summary px-4 pt-2 text-xs text-muted-foreground truncate" title={cast.filter(item => inPerson.includes(item.id)).map(item => item.name).join(', ')}>
        In Person: {cast.filter(item => inPerson.includes(item.id)).map(item => item.name).join(', ') || 'None · full AI Partner read-through'}
      </p>
      <div className="grid grid-cols-2 gap-3 p-3" aria-live="polite" aria-atomic="true">
        <div aria-label="Speaking now" className="min-w-0 rounded-lg border border-border border-l-4 bg-muted/40 px-3 py-2"
          style={{ borderLeftColor: getCharacterColor(character) }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{completed ? 'Finished' : `Now · Turn ${turnIndex + 1}`}</p>
          <p className="scene-cue-name break-words text-lg font-bold leading-tight">{completed ? 'Scene complete' : character?.name ?? 'Unassigned'}</p>
          {character && <p className="text-xs font-semibold">{mine ? 'In Person' : 'AI Partner'}</p>}
          <p className="mt-1 text-xs">{completed ? 'Start over for another rehearsal.' : status}</p>
        </div>
        <div aria-label="Up next" className="min-w-0 rounded-lg border border-border border-l-4 px-3 py-2"
          style={{ borderLeftColor: getCharacterColor(nextCharacter) }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Up next</p>
          <p className="scene-cue-name break-words text-lg font-bold leading-tight">{next ? nextCharacter?.name ?? 'Unassigned' : 'End of scene'}</p>
          {nextCharacter && <p className="text-xs font-semibold">{inPerson.includes(nextCharacter.id) ? 'In Person' : 'AI Partner'}</p>}
          {next && <p className="scene-next-words mt-1 line-clamp-2 text-xs text-muted-foreground">{next.content.slice(0, 180)}</p>}
        </div>
      </div>
    </div>
  </section>;
}
