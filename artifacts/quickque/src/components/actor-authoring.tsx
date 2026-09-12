import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash, Users, User, Mic, Volume2, AlertCircle, Square, RefreshCw } from 'lucide-react';
import { listLocalVoices, createSceneSpeech, type LocalVoice } from '@/lib/scene-speech';
import type { ActorCharacter, ActorMode, ScriptSection } from '@/lib/types';
import { CHARACTER_COLORS, getCharacterColor, nextCharacterColor } from '@/lib/actor-colors';
import { toast } from '@/hooks/use-toast';
import { generateId } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

export type ScriptActor = ActorMode;

export function ActorAuthoringPanel({
  actor,
  onChange,
  onClose,
  sections,
  onDeleteCharacter,
}: {
  actor?: ScriptActor;
  onChange: (actor: ScriptActor) => void;
  onClose: () => void;
  sections: ScriptSection[];
  onDeleteCharacter: (oldId: string, newId: string | null) => void;
}) {
  const currentActor = actor || { enabled: false, characters: [], myRoleIds: [] };
  const [voices, setVoices] = useState<LocalVoice[]>([]);
  const [voiceLoadError, setVoiceLoadError] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  
  // Deletion state
  const [deletingCharId, setDeletingCharId] = useState<string | null>(null);
  const [reassignToId, setReassignToId] = useState<string | 'unassign'>('unassign');

  const loadVoices = async () => {
    setLoadingVoices(true);
    setVoiceLoadError(false);
    try {
      const localVoices = await listLocalVoices();
      setVoices(localVoices);
    } catch {
      setVoiceLoadError(true);
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    loadVoices();
  }, []);

  const speechRef = useRef(createSceneSpeech());
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reportStopFailure = () => {
    const message = 'Could not confirm speech stopped. Restart Quickque before using microphone following.';
    setPreviewError(message);
    // The app-level toast survives closure/navigation of the cast panel.
    toast({ title: 'Speech stop failed', description: message, variant: 'destructive' });
  };

  const stopPreview = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    void speechRef.current.stop().catch(reportStopFailure);
    setIsPreviewing(null);
  };

  const handleClose = async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsPreviewing(null);
    try {
      await speechRef.current.stop();
      onClose();
    } catch {
      reportStopFailure();
    }
  };

  const handleSetEditingCharId = (id: string | null) => {
    stopPreview();
    setEditingCharId(id);
  };

  const handleToggle = () => {
    stopPreview();
    onChange({ ...currentActor, enabled: !currentActor.enabled });
  };

  const handleAddChar = () => {
    if (currentActor.characters.length >= 100) return;
    const newChar: ActorCharacter = {
      id: generateId(),
      name: 'New Character',
      accentColor: nextCharacterColor(currentActor.characters),
      age: '',
      gender: '',
      style: '',
      voice: { engine: 'system', voiceId: '', rate: 1.0 },
    };
    onChange({ ...currentActor, characters: [...currentActor.characters, newChar] });
    setEditingCharId(newChar.id);
  };

  const handleUpdateChar = (id: string, updates: Partial<ActorCharacter>) => {
    if (isPreviewing === id) {
      stopPreview();
    }
    onChange({
      ...currentActor,
      characters: currentActor.characters.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    });
  };

  const confirmDeleteChar = () => {
    if (!deletingCharId) return;
    stopPreview();
    // Cast, selected roles and turn references must commit as one transaction.
    onDeleteCharacter(deletingCharId, reassignToId === 'unassign' ? null : reassignToId);
    setDeletingCharId(null);
    setReassignToId('unassign');
  };

  const setAssignment = (id: string, inPerson: boolean) => {
    stopPreview();
    onChange({
      ...currentActor,
      myRoleIds: inPerson
        ? [...currentActor.myRoleIds.filter(roleId => roleId !== id), id]
        : currentActor.myRoleIds.filter(roleId => roleId !== id),
    });
  };

  const previewVoice = async (char: ActorCharacter) => {
    const wasSame = isPreviewing === char.id;
    stopPreview();
    if (wasSame) return;
    setPreviewError(null);
    setIsPreviewing(char.id);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await speechRef.current.speak(
        'This is a preview of the selected local voice.',
        char.voice,
        controller.signal
      );
    } catch {
      if (!controller.signal.aborted && abortControllerRef.current === controller) {
        setPreviewError('Voice preview failed. Refresh local voices, choose an installed system voice, then retry.');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setIsPreviewing(null);
      }
    }
  };

  useEffect(() => {
    return () => {
      // Cleanup reads refs, not the initial render's isPreviewing state.
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      void speechRef.current.stop().catch(() => {
        toast({
          title: 'Speech stop failed',
          description: 'Restart Quickque before using microphone following.',
          variant: 'destructive',
        });
      });
    };
  }, []);

  // Moving to another script or changing its saved voice configuration must
  // also cancel a preview, even if this panel remains mounted.
  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    void speechRef.current.stop().catch(reportStopFailure);
    setIsPreviewing(null);
  }, [actor]);

  return (
    <div className="absolute inset-y-0 right-0 w-full md:w-96 bg-background border-l border-border shadow-2xl flex flex-col z-50">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Scene Partner Cast
        </h2>
        <button aria-label="Close scene partner cast" onClick={handleClose} className="p-2 hover:bg-muted rounded-full">
          &times;
        </button>
      </div>

      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="text-sm font-medium">Partner audio</label>
          <p className="text-xs text-muted-foreground">Record on another camera. Quickque never records.</p>
        </div>
        <button
          role="switch"
          aria-label="Partner audio"
          aria-checked={currentActor.enabled}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            currentActor.enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              currentActor.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {(
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-sm font-medium">1. Add cast · 2. Assign In Person or AI Partner · 3. Assign turns in the editor · 4. Preview partner voices · 5. Rehearse</p>
          <p className="text-xs text-muted-foreground">Choose In Person for characters you or another person will perform. AI Partner reads its lines using a local system voice. Give each character a colour to recognise their turns. All In Person means silent cues; all AI Partner means a full read-through.</p>
          {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
          <div className="space-y-4">
            {currentActor.characters.map((char) => (
              <div
                key={char.id}
                className="bg-card border border-border border-l-4 rounded-xl overflow-hidden shadow-sm"
                style={{ borderLeftColor: getCharacterColor(char) }}
              >
                <div 
                  className="p-3 bg-muted/50 flex items-center justify-between cursor-pointer"
                  onClick={() => handleSetEditingCharId(editingCharId === char.id ? null : char.id)}
                    onKeyDown={event => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        handleSetEditingCharId(editingCharId === char.id ? null : char.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit ${char.name}`}
                    aria-expanded={editingCharId === char.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-foreground/20" style={{ backgroundColor: getCharacterColor(char) }} />
                    <div>
                      <h3 className="font-medium text-sm break-words">{char.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {currentActor.myRoleIds.includes(char.id) ? "In Person" : "AI Partner"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!currentActor.myRoleIds.includes(char.id) && (
                      <button
                        aria-label={isPreviewing === char.id ? `Stop preview for ${char.name}` : `Preview voice for ${char.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          previewVoice(char);
                        }}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded"
                      >
                        {isPreviewing === char.id ? <Square className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      aria-label={`Delete ${char.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingCharId(char.id);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="px-3 py-3 border-t border-border space-y-3">
                  <div role="group" aria-label={`Who performs ${char.name}?`} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                    {(['In Person', 'AI Partner'] as const).map(label => {
                      const selected = currentActor.myRoleIds.includes(char.id) === (label === 'In Person');
                      return <button key={label} type="button" aria-pressed={selected}
                        onClick={() => setAssignment(char.id, label === 'In Person')}
                        className={`flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}>
                        {label === 'In Person' ? <User className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}{label}
                      </button>;
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">Character colour</span>
                    <input type="color" aria-label={`Colour for ${char.name}`} value={getCharacterColor(char)}
                      onChange={event => handleUpdateChar(char.id, { accentColor: event.target.value })}
                      className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
                  </div>
                  <div role="group" aria-label={`Colour presets for ${char.name}`} className="flex flex-wrap gap-2">
                    {CHARACTER_COLORS.map(color => <button key={color.value} type="button"
                      aria-label={color.name} title={color.name} aria-pressed={getCharacterColor(char).toLowerCase() === color.value}
                      onClick={() => handleUpdateChar(char.id, { accentColor: color.value })}
                      className={`h-7 w-7 rounded-full border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${getCharacterColor(char).toLowerCase() === color.value ? 'border-foreground ring-2 ring-background ring-offset-2 ring-offset-foreground' : 'border-foreground/20'}`}
                      style={{ backgroundColor: color.value }} />)}
                  </div>
                </div>

                {editingCharId === char.id && (
                  <div className="p-4 space-y-4 border-t border-border bg-background">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Character Name</label>
                      <input
                        type="text"
                        aria-label="Character Name"
                        maxLength={200}
                        value={char.name}
                        onChange={(e) => handleUpdateChar(char.id, { name: e.target.value })}
                        className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                        placeholder="e.g. Juliet"
                      />
                    </div>
                    
                    <details className="space-y-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Optional character descriptions</summary>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Age Description</label>
                        <input
                          type="text"
                          aria-label="Age Description"
                          maxLength={200}
                          value={char.age}
                          onChange={(e) => handleUpdateChar(char.id, { age: e.target.value })}
                          className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                          placeholder="e.g. 20s"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Gender</label>
                        <input
                          type="text"
                          aria-label="Gender"
                          maxLength={200}
                          value={char.gender}
                          onChange={(e) => handleUpdateChar(char.id, { gender: e.target.value })}
                          className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                          placeholder="e.g. Female"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Performance Style / Notes</label>
                      <input
                        type="text"
                        aria-label="Performance Style"
                        maxLength={500}
                        value={char.style}
                        onChange={(e) => handleUpdateChar(char.id, { style: e.target.value })}
                        className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                        placeholder="e.g. Enthusiastic, slight accent"
                      />
                    </div>

                    </details>
                    {!currentActor.myRoleIds.includes(char.id) && (
                      <div className="space-y-3 pt-3 border-t border-border">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Voice (Engine)</label>
                          <select
                            aria-label="Voice Engine"
                            value={char.voice.engine}
                            onChange={(e) => handleUpdateChar(char.id, { voice: { ...char.voice, engine: e.target.value as 'system'|'turbo' } })}
                            className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                          >
                            <option value="system">System (Local)</option>
                            <option value="turbo" disabled>Turbo (Unavailable)</option>
                          </select>
                        </div>
                        
                        {char.voice.engine === 'turbo' && (
                          <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-md text-xs flex gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <p>Turbo is unavailable: Apple Silicon performance, a rights-cleared voice pack and self-contained packaging are not verified. Choose a system voice explicitly.</p>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium">Voice Selection</label>
                            {voiceLoadError && (
                              <button onClick={loadVoices} className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 transition-colors">
                                <RefreshCw className="w-3 h-3" />
                                Retry
                              </button>
                            )}
                          </div>
                          <select
                            aria-label="Voice Selection"
                            value={char.voice.voiceId}
                            onChange={(e) => handleUpdateChar(char.id, { voice: { ...char.voice, voiceId: e.target.value } })}
                            className="w-full bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                            disabled={char.voice.engine === 'turbo' || voices.length === 0 || loadingVoices}
                          >
                            {!loadingVoices && voices.length > 0 && !voices.some(voice => voice.id === char.voice.voiceId) &&
                              <option value={char.voice.voiceId}>{char.voice.voiceId ? 'Saved voice unavailable — choose a voice' : 'Choose a local voice'}</option>}
                            {loadingVoices ? (
                              <option value="">Loading voices...</option>
                            ) : voices.length === 0 ? (
                              <option value="">No voices found...</option>
                            ) : (
                              voices.map(v => (
                                <option key={v.id} value={v.id}>{v.name} ({v.language})</option>
                              ))
                            )}
                          </select>
                          {!loadingVoices && (voiceLoadError || voices.length === 0) && (
                            <p role="status" className="text-xs text-muted-foreground">
                              {voiceLoadError ? 'Could not list local voices. Retry or check the Mac speech helper installation.' : 'No confirmed local voices are available. Assign every character as In Person for silent turn cues, switch Partner audio off to read at your own pace, or choose an installed voice in the Mac app.'}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between">
                            <label className="text-xs font-medium">Speaking Rate ({char.voice.rate.toFixed(1)}x)</label>
                          </div>
                          <input
                            type="range"
                            aria-label="Speaking Rate"
                            disabled={char.voice.engine !== 'system'}
                            min="0.5"
                            max="2"
                            step="0.1"
                            value={char.voice.rate}
                            onChange={(e) => handleUpdateChar(char.id, { voice: { ...char.voice, rate: parseFloat(e.target.value) } })}
                            className="w-full"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleAddChar}
            disabled={currentActor.characters.length >= 100}
            className={`w-full py-3 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center justify-center gap-2 text-sm font-medium ${
              currentActor.characters.length >= 100 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Plus className="w-4 h-4" />
            {currentActor.characters.length >= 100 ? 'Maximum 100 Characters Reached' : 'Add Character'}
          </button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingCharId} onOpenChange={(o) => !o && setDeletingCharId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Character</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this character? You can reassign their lines to another character.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reassign lines to:</label>
              <select
                aria-label="Reassign lines to"
                value={reassignToId}
                onChange={(e) => setReassignToId(e.target.value)}
                className="w-full bg-transparent border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option value="unassign">Unassign lines</option>
                {currentActor.characters
                  .filter((c) => c.id !== deletingCharId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setDeletingCharId(null)}
              className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteChar}
              className="px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
