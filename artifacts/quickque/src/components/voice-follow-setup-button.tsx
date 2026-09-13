import { useMemo, useState } from 'react';
import { isDesktop } from '@/lib/desktop';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { tokenize } from '@/lib/flow/tokenize';
import { FlowSetupWizard } from './flow-setup-wizard';

export function VoiceFollowSetupButton() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const tokens = useMemo(() => tokenize('Testing microphone permissions for Quickque Voice Follow.').map((token, index) => ({ ...token, sectionIdx: 0, globalTokenIdx: index })), []);
  const flow = useLocalFlow({ tokens, enabled: open });
  const close = () => { setOpen(false); flow.stop(); };
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Voice Follow · Scroll as you speak</h3>
    <p className="text-sm text-muted-foreground">Uses your microphone to follow your reading. This is separate from AI voices and does not use the Chatterbox model. Speech stays on your Mac.</p>
    {isDesktop() ? <>
      <p className="text-xs text-muted-foreground">The setup checks microphone permission and any Apple speech download your Mac needs.</p>
      <button type="button" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted" onClick={() => setOpen(true)}>{checked ? 'Check Voice Follow again' : 'Set up Voice Follow'}</button>
      {checked && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Microphone and Voice Follow checked.</p>}
    </> : <p className="text-sm text-muted-foreground">Available in the Mac app. Manual reading is available here.</p>}
    {open && <FlowSetupWizard flow={flow} onCancel={close} onComplete={() => { setChecked(true); close(); }} />}
  </section>;
}
