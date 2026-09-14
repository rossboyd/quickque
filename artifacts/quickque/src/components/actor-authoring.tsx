import { ChatterboxSetup } from './chatterbox-setup';
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Users, User, Volume2, Square, RefreshCw, X, Play, Settings2, Sparkles, ChevronRight, ChevronDown, Palette, Check } from 'lucide-react';
import { createSceneSpeech, voiceFailureMessage } from '@/lib/scene-speech';
import { createVoiceLibrary, type ClonedVoice } from '@/lib/voice-library';
import { VoiceLibraryPanel } from '@/components/voice-library';
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
  onRehearse,
  sections,
  onDeleteCharacter,
}: {
  actor?: ScriptActor;
  onChange: (actor: ScriptActor) => void;
  onClose: () => void;
  onRehearse: () => void;
  sections: ScriptSection[];
  onDeleteCharacter: (oldId: string, newId: string | null) => void;
}) {
  const currentActor = actor || { enabled: false, characters: [], myRoleIds: [] };
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [voiceLoadError, setVoiceLoadError] = useState<string | null>(null);
  const [voiceRefreshStatus, setVoiceRefreshStatus] = useState<string | null>(null);
  const voiceLoadGeneration = useRef(0);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);

  // Deletion state
  const [deletingCharId, setDeletingCharId] = useState<string | null>(null);
  const [reassignToId, setReassignToId] = useState<string | 'unassign'>('unassign');
  const voiceLibrary = useRef(createVoiceLibrary());

  const loadVoices = async () => {
    const generation = ++voiceLoadGeneration.current;
    setLoadingVoices(true);
    setVoiceLoadError(null);
    setVoiceRefreshStatus(null);
    try {
      const localVoices = await voiceLibrary.current.list();
      if (generation !== voiceLoadGeneration.current) return;
      setVoices(localVoices);
      setPreviewError(null);
      setVoiceRefreshStatus(`${localVoices.length} cloned ${localVoices.length === 1 ? "voice" : "voices"} found.`);
    } catch (error) {
      if (generation === voiceLoadGeneration.current) {
        setVoices([]);
        setVoiceLoadError(voiceFailureMessage(error));
      }
    } finally {
      if (generation === voiceLoadGeneration.current) setLoadingVoices(false);
    }
  };

  useEffect(() => {
    void loadVoices();
    return () => { voiceLoadGeneration.current += 1; };
  }, []);

  const speechRef = useRef(createSceneSpeech());
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reportStopFailure = () => {
    const message = 'Could not confirm speech stopped. Restart Quickque before using microphone following.';
    setPreviewError(message);
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
       voice: { engine: 'turbo', voiceId: '', rate: 1.0 },
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
    if (char.voice.engine !== 'turbo') {
      setPreviewError('This saved system voice is unavailable. Choose or record a local Chatterbox voice.');
      return;
    }
    setIsPreviewing(char.id);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await speechRef.current.speak(
        'This is a preview of the selected local voice.',
        { engine: 'turbo', voiceId: char.voice.voiceId, rate: char.voice.rate, voiceRevision: char.voice.voiceRevision },
        controller.signal
      );
    } catch (error) {
      if (!controller.signal.aborted && abortControllerRef.current === controller) {
        setPreviewError(voiceFailureMessage(error));
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

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    void speechRef.current.stop().catch(reportStopFailure);
    setIsPreviewing(null);
  }, [actor]);

  return (
    <div className="absolute inset-y-0 right-0 w-full md:w-[420px] bg-background border-l border-border shadow-[0_0_40px_rgba(0,0,0,0.1)] flex flex-col z-50 overflow-hidden text-foreground">
      {/* Header Area */}
      <div className="flex-none px-5 py-4 border-b border-border bg-card/80 backdrop-blur-xl z-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Users className="w-4 h-4" />
            </div>
            Scene Cast
          </h2>
          <button
            aria-label="Close setup"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`p-3.5 rounded-xl border transition-all ${
          currentActor.enabled
            ? 'bg-primary/5 border-primary/20 shadow-sm'
            : 'bg-muted/40 border-border/50'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 flex-1">
              <label className="text-sm font-semibold flex items-center gap-2 cursor-pointer select-none" onClick={handleToggle}>
                Rehearsal Audio
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Quickque will read aloud the lines of any character assigned as AI Partner.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={currentActor.enabled}
              onClick={handleToggle}
              className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                currentActor.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                currentActor.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main List Area */}
      <div className="flex-1 overflow-y-auto bg-muted/10">
        <div className="p-5 space-y-3">
          {voiceRefreshStatus && (
            <p role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50">
              {voiceRefreshStatus}
            </p>
          )}
          {voiceLoadError && (
            <p role="alert" className="text-xs font-medium text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20">
              {voiceLoadError}
            </p>
          )}
          {previewError && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 space-y-2">
              <p className="text-xs font-medium text-destructive leading-relaxed">{previewError}</p>
              <button
                type="button"
                onClick={() => void loadVoices()}
                disabled={loadingVoices}
                className="flex items-center gap-1.5 text-xs font-semibold text-destructive hover:text-destructive/80 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingVoices ? 'animate-spin' : ''}`} />
                Retry loading voices
              </button>
            </div>
          )}

          {currentActor.characters.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center mb-4 border border-border/50">
                <User className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-sm font-semibold mb-1">No characters</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mx-auto">Add characters to start assigning rehearsal roles.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {currentActor.characters.map((char) => {
                const isExpanded = editingCharId === char.id;
                const isInPerson = currentActor.myRoleIds.includes(char.id);

                return (
                  <div
                    key={char.id}
                    className={`group flex flex-col rounded-xl border transition-all duration-200 ${
                      isExpanded
                        ? 'border-border bg-card shadow-md relative z-10'
                        : 'border-transparent bg-muted/40 hover:bg-muted/60'
                    }`}
                  >
                    {/* Collapsed/Header View */}
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 p-3 text-left outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => handleSetEditingCharId(isExpanded ? null : char.id)}
                    >
                      <div
                        className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-black/10 dark:border-white/10 shadow-sm"
                        style={{ backgroundColor: getCharacterColor(char) }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium text-[15px] text-foreground">
                          {char.name || 'Unnamed Character'}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
                          {isInPerson ? (
                            <><User className="w-3 h-3" /> You (In Person)</>
                          ) : (
                            <><Sparkles className="w-3 h-3 text-primary/70" /> AI Partner</>
                          )}
                        </div>
                      </div>

                      {!isInPerson && !isExpanded && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); previewVoice(char); }}
                          className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full border shadow-sm transition-colors ${
                            isPreviewing === char.id
                              ? 'bg-primary border-primary text-primary-foreground animate-pulse'
                              : 'bg-background border-border text-muted-foreground hover:text-primary hover:border-primary/30'
                          }`}
                        >
                          {isPreviewing === char.id ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </div>
                      )}
                    </button>

                    {/* Expanded View */}
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-5 border-t border-border mt-1 pt-4">
                        {/* Name Input */}
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Character Name</label>
                          <input
                            type="text"
                            value={char.name}
                            onChange={(e) => handleUpdateChar(char.id, { name: e.target.value })}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:font-normal"
                            placeholder="e.g. Juliet"
                          />
                        </div>

                        {/* Role Assignment */}
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Who performs this role?</label>
                          <div className="flex p-1 bg-muted/60 rounded-lg border border-border/50">
                            <button
                              type="button"
                              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-all ${
                                isInPerson
                                  ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/5'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                              onClick={() => setAssignment(char.id, true)}
                            >
                              <User className="w-3.5 h-3.5" />
                              In Person
                            </button>
                            <button
                              type="button"
                              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-all ${
                                !isInPerson
                                  ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/5'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                              onClick={() => setAssignment(char.id, false)}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              AI Partner
                            </button>
                          </div>
                        </div>

                        {/* AI Partner Settings */}
                        {!isInPerson && (
                          <div className="space-y-4 pt-4 border-t border-border/50">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Voice Selection</label>
                                <button
                                  type="button"
                                  onClick={() => void loadVoices()}
                                  disabled={loadingVoices}
                                  className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50 font-medium"
                                >
                                  <RefreshCw className={`w-3 h-3 ${loadingVoices ? 'animate-spin' : ''}`} />
                                  Refresh
                                </button>
                              </div>

                              <div className="flex gap-2">
                                <div className="relative flex-1 min-w-0">
                                  <select
                                    value={char.voice.voiceId}
                                    onChange={(e) => {
                                      const selected = voices.find(voice => voice.referenceId === e.target.value);
                                      handleUpdateChar(char.id, {
                                        voice: {
                                          ...char.voice,
                                          voiceId: e.target.value,
                                          ...(selected ? { voiceRevision: selected.revision } : {}),
                                        },
                                      });
                                    }}
                                    className="w-full bg-background border border-border rounded-lg pl-3 pr-8 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary appearance-none truncate"
                                    disabled={voices.length === 0 || loadingVoices}
                                  >
                                    {!loadingVoices && char.voice.voiceId && !voices.some(voice => voice.referenceId === char.voice.voiceId) && (
                                      <option value={char.voice.voiceId}>Saved voice unavailable...</option>
                                    )}
                                    {loadingVoices ? (
                                      <option value="">Loading voices...</option>
                                    ) : voices.length === 0 ? (
                                      <option value="">No cloned voices found</option>
                                    ) : (
                                      voices.map(v => (
                                        <option key={v.id} value={v.referenceId}>{v.name} (revision {v.revision})</option>
                                      ))
                                    )}
                                  </select>
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                                    <ChevronDown className="w-4 h-4" />
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => previewVoice(char)}
                                  disabled={!char.voice.voiceId}
                                  className={`shrink-0 aspect-square w-[42px] flex items-center justify-center rounded-lg border transition-all ${
                                    isPreviewing === char.id
                                      ? 'bg-primary border-primary text-primary-foreground shadow-inner'
                                      : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20 hover:border-primary/30 disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground disabled:border-border'
                                  }`}
                                >
                                  {isPreviewing === char.id ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Speaking Rate</label>
                                <span className="text-[11px] font-medium text-foreground bg-muted px-1.5 py-0.5 rounded">{char.voice.rate.toFixed(1)}x</span>
                              </div>
                              <input
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.1"
                                value={char.voice.rate}
                                onChange={(e) => handleUpdateChar(char.id, { voice: { ...char.voice, rate: parseFloat(e.target.value) } })}
                                className="w-full accent-primary h-1.5 bg-muted rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
                              />
                              <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                                <span>Slower</span>
                                <span>Faster</span>
                              </div>
                            </div>

                            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                              <ChatterboxSetup compact onReady={() => void loadVoices()} />
                            </div>

                            <details className="group/voice rounded-lg border border-border bg-muted/20 overflow-hidden">
                              <summary className="flex items-center gap-2.5 p-3.5 cursor-pointer text-xs font-semibold text-foreground outline-none select-none hover:bg-muted/30 transition-colors">
                                <Settings2 className="w-4 h-4 text-primary" />
                                Manage Voice Library
                                <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto transition-transform group-open/voice:rotate-180" />
                              </summary>
                              <div className="px-3.5 pb-4 pt-2 border-t border-border/50 bg-background">
                                <VoiceLibraryPanel
                                  referencedVoiceIds={currentActor.characters
                                    .map(character => character.voice.voiceId)
                                    .filter(Boolean)}
                                  onVoicesChange={setVoices}
                                />
                              </div>
                            </details>
                          </div>
                        )}

                        {/* Color Selection */}
                        <div className="space-y-2 pt-4 border-t border-border/50">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Palette className="w-3 h-3" /> Character Color
                          </label>
                          <div className="flex flex-wrap gap-2.5">
                            {CHARACTER_COLORS.map(color => {
                              const isSelected = getCharacterColor(char).toLowerCase() === color.value.toLowerCase();
                              return (
                                <button
                                  key={color.value}
                                  type="button"
                                  aria-label={color.name}
                                  title={color.name}
                                  onClick={() => handleUpdateChar(char.id, { accentColor: color.value })}
                                  className={`w-6 h-6 rounded-full transition-all flex items-center justify-center shadow-sm ${
                                    isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110' : 'hover:scale-110 ring-1 ring-black/10 dark:ring-white/10'
                                  }`}
                                  style={{ backgroundColor: color.value }}
                                >
                                  {isSelected && <Check className="w-3 h-3 text-white drop-shadow-md" />}
                                </button>
                              );
                            })}
                            <div className="relative w-6 h-6 rounded-full overflow-hidden ring-1 ring-black/10 dark:ring-white/10 hover:scale-110 transition-transform shadow-sm">
                              <input
                                type="color"
                                aria-label={`Custom color for ${char.name}`}
                                value={getCharacterColor(char)}
                                onChange={event => handleUpdateChar(char.id, { accentColor: event.target.value })}
                                className="absolute inset-0 w-[200%] h-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Optional Details */}
                        <details className="group/details pt-2 border-t border-border/50">
                          <summary className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground outline-none w-fit">
                            <ChevronRight className="w-3.5 h-3.5 transition-transform group-open/details:rotate-90" />
                            Advanced Character Details
                          </summary>
                          <div className="pt-4 pb-2 space-y-4 pl-1">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Age</label>
                                <input
                                  type="text"
                                  value={char.age}
                                  onChange={(e) => handleUpdateChar(char.id, { age: e.target.value })}
                                  className="w-full bg-transparent border border-border rounded-md px-2.5 py-1.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                  placeholder="e.g. 20s"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Gender</label>
                                <input
                                  type="text"
                                  value={char.gender}
                                  onChange={(e) => handleUpdateChar(char.id, { gender: e.target.value })}
                                  className="w-full bg-transparent border border-border rounded-md px-2.5 py-1.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                  placeholder="e.g. Female"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Style / Notes</label>
                              <input
                                type="text"
                                value={char.style}
                                onChange={(e) => handleUpdateChar(char.id, { style: e.target.value })}
                                className="w-full bg-transparent border border-border rounded-md px-2.5 py-1.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                placeholder="e.g. Enthusiastic, slight accent"
                              />
                            </div>
                          </div>
                        </details>

                        {/* Delete Action */}
                        <div className="pt-2 border-t border-border/50 flex justify-end">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeletingCharId(char.id); }}
                            className="text-[11px] font-medium text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove Character
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={handleAddChar}
            disabled={currentActor.characters.length >= 100}
            className={`w-full mt-4 py-3.5 border border-dashed border-border/80 rounded-xl text-muted-foreground hover:bg-card hover:border-primary/30 hover:text-foreground transition-all flex items-center justify-center gap-2 text-sm font-medium shadow-sm ${
              currentActor.characters.length >= 100 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Plus className="w-4 h-4" />
            {currentActor.characters.length >= 100 ? 'Maximum Characters Reached' : 'Add Character'}
          </button>
        </div>
      </div>

      {/* Footer Area */}
      <div className="flex-none p-5 bg-background border-t border-border/80 z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
        <button
          onClick={() => {
            handleClose();
            onRehearse();
          }}
          className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-medium shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4 fill-current" />
          Start Rehearsal
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingCharId} onOpenChange={(o) => !o && setDeletingCharId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Character</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this character? You can reassign their lines to someone else.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Reassign lines to:</label>
            <div className="relative">
              <select
                aria-label="Reassign lines to"
                value={reassignToId}
                onChange={(e) => setReassignToId(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-3 pr-8 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary appearance-none"
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
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeletingCharId(null)}
              className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteChar}
              className="px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg shadow-sm transition-colors"
            >
              Remove Character
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
