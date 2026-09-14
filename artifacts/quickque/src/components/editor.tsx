import { ScriptAudioPanel } from './script-audio-panel';
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { calculateWordCount, estimateTime, formatTime, generateId } from '@/lib/utils';
import { Play, Plus, Trash, ChevronUp, ChevronDown, ChevronLeft, Users, PanelLeft, SplitSquareVertical } from 'lucide-react';
import { Script, ScriptSection, Settings, DEFAULT_SETTINGS } from '@/lib/types';
import { MAX_SECTIONS } from '@/lib/store-persistence';
import { getFontFamilyCss, getTextColorCss } from '@/lib/appearance';
import { getCharacterColor } from '@/lib/actor-colors';
import { MarkdownEditor } from './markdown-editor';
import { getScriptPurpose, getSceneSetupIssues, getPerformanceSummary, type SceneSetupIssue } from '@/lib/script-purpose';
import { createVoiceLibrary } from '@/lib/voice-library';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ActorAuthoringPanel, ScriptActor } from './actor-authoring';

export type ActorScriptSection = ScriptSection & {
  characterId?: string | null;
  notes?: string;
};

export type ActorScript = Script & {
  actor?: ScriptActor;
  sections: ActorScriptSection[];
};

export function Editor({ 
  script: baseScript, 
  onChange, 
  onPresent, 
  onCloseMobile,
  libraryVisible = true,
  onToggleLibrary,
  settings = DEFAULT_SETTINGS,
}: { 
  script: Script; 
  onChange: (u: Partial<Script>) => boolean; 
  onPresent: () => void; 
  onCloseMobile: () => void;
  libraryVisible?: boolean;
  onToggleLibrary?: () => void;
  settings?: Settings;
}) {
  const script = baseScript as ActorScript;
  const isPerformance = getScriptPurpose(script) === 'performance';
  const sectionLabel = isPerformance ? 'turn' : 'section';
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [checkingVoices, setCheckingVoices] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<SceneSetupIssue[] | null>(null);
  const voiceLibrary = useMemo(() => createVoiceLibrary(), []);
  const currentScript = useRef<ActorScript | null>(script);
  currentScript.current = script;
  useEffect(() => {
    currentScript.current = script;
    return () => { currentScript.current = null; };
  }, [script]);
  const startReader = async () => {
    if (!isPerformance || !script.actor?.enabled) { onPresent(); return; }
    const issues = getSceneSetupIssues(script);
    if (issues.length) { setPreflightIssues(issues); return; }
    // A silent all-roles rehearsal does not need a speech engine.
    const partnerTurns = script.sections.some(s => s.characterId && !script.actor!.myRoleIds.includes(s.characterId));
    if (!partnerTurns) { onPresent(); return; }
    setCheckingVoices(true);
    try {
      const voices = await voiceLibrary.list();
      if (currentScript.current !== script) return;
      const checked = getSceneSetupIssues(script, new Set(voices.map(v => v.referenceId)));
      if (checked.length) setPreflightIssues(checked);
      else onPresent();
    } catch {
      if (currentScript.current === script) setPreflightIssues([{ message: 'Could not check local voices. Open Scene Partner setup to refresh voices, then try Rehearse again.' }]);
    } finally { setCheckingVoices(false); }
  };
  const setupIssues = getSceneSetupIssues(script);
  const totalWords = script.sections.reduce((acc, sec) => acc + calculateWordCount(sec.content), 0);
  const timeSec = estimateTime(totalWords);
  const [showActorPanel, setShowActorPanel] = useState(false);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const documentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grow = () => {
      textareaRefs.current.forEach(field => {
        field.style.height = 'auto';
        field.style.height = `${Math.max(96, field.scrollHeight)}px`;
      });
    };
    grow();
    const document = documentRef.current;
    if (!document) return;
    let width = document.clientWidth;
    const observer = new ResizeObserver(() => {
      if (document.clientWidth === width) return;
      width = document.clientWidth;
      grow();
    });
    observer.observe(document);
    return () => observer.disconnect();
  }, [script.sections, settings.fontFamily]);

  const addSection = () => {
    onChange({
      sections: [...script.sections, { id: generateId(), title: isPerformance ? 'New Turn' : 'New Section', content: '' }]
    });
  };

  const updateSection = (id: string, updates: Partial<ActorScriptSection>) => {
    onChange({
      sections: script.sections.map((s) => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const deleteSection = (id: string) => {
    if (script.sections.length <= 1) return;
    onChange({
      sections: script.sections.filter((s) => s.id !== id)
    });
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= script.sections.length) return;
    const newSections = [...script.sections];
    const temp = newSections[index];
    newSections[index] = newSections[index + direction];
    newSections[index + direction] = temp;
    onChange({ sections: newSections });
  };
  
  const splitSection = (id: string) => {
    if (script.sections.length >= MAX_SECTIONS) return;
    const sectionIndex = script.sections.findIndex(s => s.id === id);
    if (sectionIndex === -1) return;
    const section = script.sections[sectionIndex];
    
    const textarea = textareaRefs.current.get(id);
    const cursorPosition = textarea?.selectionStart ?? section.content.length;
    
    const textBefore = section.content.substring(0, cursorPosition);
    const textAfter = section.content.substring(cursorPosition);
    
    const newSections = [...script.sections];
    
    // Update current section
    newSections[sectionIndex] = {
      ...section,
      content: textBefore
    };
    
    // Insert new section
    newSections.splice(sectionIndex + 1, 0, {
      id: generateId(),
      title: `${section.title.slice(0, 192)} (Cont.)`,
      content: textAfter,
      characterId: section.characterId,
      notes: ''
    });
    
    onChange({ sections: newSections });
  };

  const handleActorChange = (actor: ScriptActor) => {
    onChange({ actor, purpose: 'performance' });
  };

  const handleDeleteCharacter = (oldId: string, newId: string | null) => {
    if (!script.actor) return;
    onChange({
      actor: {
        ...script.actor,
        characters: script.actor.characters.filter(character => character.id !== oldId),
        myRoleIds: script.actor.myRoleIds.filter(id => id !== oldId),
      },
      sections: script.sections.map((s) => 
        s.characterId === oldId ? { ...s, characterId: newId } : s
      )
    });
  };

  const isActorEnabled = isPerformance && (script.actor?.enabled ?? false);

  return (
    <div className="workspace-editor flex-1 flex overflow-hidden relative">
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="editor-toolbar flex-shrink-0 border-b border-border z-10 px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button 
                onClick={onCloseMobile}
                className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                aria-label="Back to library"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button type="button" onClick={onToggleLibrary} aria-label={libraryVisible ? 'Hide library' : 'Show library'} aria-expanded={libraryVisible} className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><PanelLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Back to workspace" onClick={onCloseMobile} className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground">Workspace <span className="mx-2 opacity-40">/</span></button>
              <span className="truncate text-sm font-medium">{script.title || 'Untitled script'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => setShowMarkdown(true)} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Markdown</button>
              {isPerformance && <button
                aria-label="Scene Partner setup"
                onClick={() => setShowActorPanel(true)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors text-sm border focus:outline-none focus:ring-2 focus:ring-primary ${
                  isActorEnabled 
                    ? 'bg-transparent text-foreground border-border hover:bg-muted'
                    : 'bg-background border-border text-foreground hover:bg-muted'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Scene Partner</span>
              </button>}
              <button 
                onClick={startReader}
                disabled={checkingVoices}
                className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              >
                <Play className="w-4 h-4 md:w-5 md:h-5 fill-current" />
                {checkingVoices ? 'Checking voices…' : isPerformance ? 'Rehearse' : 'Present'}
              </button>
            </div>
          </div>
        </div>

        <div className="editor-canvas flex-1 overflow-y-auto px-4 md:px-10 py-8 md:py-12">
          <div ref={documentRef} className="editor-document max-w-[760px] mx-auto space-y-7 pb-24">
            <div className="document-heading pb-7 border-b border-border">              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={script.title}
                  onChange={e => onChange({ title: e.target.value })}
                  maxLength={200}
                  className="w-full bg-transparent text-3xl md:text-[42px] leading-tight font-semibold tracking-tight text-foreground focus:outline-none placeholder:text-muted-foreground/50 truncate"
                  placeholder="Script Title"
                  aria-label="Script Title"
                />
                 <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground">
                  <select aria-label="Script type" value={getScriptPurpose(script)} onChange={event => {
                    const purpose = event.target.value as 'presentation' | 'performance';
                    onChange({ purpose, ...(purpose === 'performance' && !script.actor ? { actor: { enabled: true, characters: [], myRoleIds: [] } } : {}) });
                    setShowActorPanel(false);
                  }} className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <option value="presentation">Presentation</option>
                    <option value="performance">Performance</option>
                  </select>
                  <span>{totalWords} words</span>
                  <span className="hidden sm:inline">Estimated time: {formatTime(timeSec)}</span>
                  <span className="sm:hidden">~{formatTime(timeSec)}</span>
                  <span>{script.sections.length} {sectionLabel}{script.sections.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
            {isPerformance && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <p>{getPerformanceSummary(script)}</p>
              <div className="flex items-center gap-3">
                <span role="status">{!isActorEnabled ? 'Partner audio off' : setupIssues.length ? `${setupIssues.length} setup ${setupIssues.length === 1 ? 'issue' : 'issues'}` : 'Ready to rehearse'}</span>
                {isActorEnabled && setupIssues.length > 0 && <button onClick={() => setPreflightIssues(setupIssues)} className="font-medium text-primary hover:underline">Review setup</button>}
              </div>
            </div>}
            <ScriptAudioPanel key={script.id} script={script} />
            {script.sections.map((section, idx) => (
              <div key={section.id} style={isPerformance ? { borderLeftWidth: 4, borderLeftColor: getCharacterColor(script.actor?.characters.find(character => character.id === section.characterId)) } : undefined} className="document-section group relative border-b border-border/70 pb-6 focus-within:border-primary/40 transition-colors">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center justify-between gap-2 py-2">
                    <div className="flex items-center flex-1 gap-2 min-w-0">
                      <div className="section-tools section-reorder flex flex-col text-muted-foreground flex-shrink-0">
                        <button 
                          onClick={() => moveSection(idx, -1)} 
                          disabled={idx === 0}
                          className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                          aria-label={`Move ${sectionLabel} "${section.title}" up`}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => moveSection(idx, 1)} 
                          disabled={idx === script.sections.length - 1}
                          className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                          aria-label={`Move ${sectionLabel} "${section.title}" down`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={section.title}
                        onChange={e => updateSection(section.id, { title: e.target.value })}
                        maxLength={200}
                        className="flex-1 min-w-0 bg-transparent font-semibold text-foreground focus:outline-none px-2 py-1"
                        placeholder={isPerformance ? 'Turn Title' : 'Section Title'}
                        aria-label={isPerformance ? 'Turn Title' : 'Section Title'}
                      />
                    </div>
                    
                    <div className="section-tools flex items-center gap-1 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => splitSection(section.id)}
                        className="p-1.5 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                        title="Split at cursor"
                        aria-label={`Split ${sectionLabel} at cursor`}
                      >
                        <SplitSquareVertical className="w-4 h-4" />
                      </button>
                      <div className="text-xs text-muted-foreground px-2 py-1 hidden sm:block">
                        {calculateWordCount(section.content)} w
                      </div>
                      {script.sections.length > 1 && (
                        <button 
                          onClick={() => deleteSection(section.id)}
                          className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
                          title={`Delete ${sectionLabel}`}
                          aria-label={`Delete ${sectionLabel} "${section.title}"`}
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3 px-2 pb-3 pt-1">
                    {isPerformance && (
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-foreground/20" style={{ backgroundColor: getCharacterColor(script.actor?.characters.find(character => character.id === section.characterId)) }} />
                        <label className="text-xs font-medium text-muted-foreground">Character:</label>
                        <select
                          aria-label={`Character for turn ${idx + 1}`}
                          value={section.characterId || ''}
                          onChange={(e) => updateSection(section.id, { characterId: e.target.value || null })}
                          className="bg-background border border-border text-sm rounded-md px-2 py-1 focus:outline-none focus:border-primary"
                        >
                          <option value="">Unassigned</option>
                          {script.actor?.characters.map((char) => (
                            <option key={char.id} value={char.id}>{char.name} · {script.actor?.myRoleIds.includes(char.id) ? 'In Person' : 'AI Partner'}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <details className="section-notes flex-1 min-w-[180px] text-xs text-muted-foreground" open={section.notes ? true : undefined}>
                      <summary className="cursor-pointer py-1">{section.notes ? 'Notes' : 'Add a note'}</summary>
                      <div className="flex items-center gap-2 pt-1">
                      <label className="text-xs font-medium text-muted-foreground">Notes:</label>
                      <input
                        type="text"
                        value={section.notes || ''}
                        onChange={(e) => updateSection(section.id, { notes: e.target.value })}
                        className="flex-1 bg-background border border-border text-sm rounded-md px-2 py-1 focus:outline-none focus:border-primary"
                        placeholder="Action, emotion, or direction..."
                        aria-label={`Notes for ${sectionLabel} ${idx + 1}`}
                      />
                      </div>
                    </details>
                  </div>
                </div>
                
                <textarea
                  ref={(el) => {
                    if (el) textareaRefs.current.set(section.id, el);
                    else textareaRefs.current.delete(section.id);
                  }}
                  value={section.content}
                  onChange={e => updateSection(section.id, { content: e.target.value })}
                  maxLength={500000}
                  className="document-text w-full bg-transparent text-foreground px-2 py-3 min-h-[96px] resize-none overflow-hidden focus:outline-none leading-[1.85]"
                  placeholder="Type your script here..."
                  aria-label={`${isPerformance ? 'Turn' : 'Section'} content for "${section.title}"`}
                  style={{
                    fontSize: '1.05rem',
                    fontFamily: getFontFamilyCss(settings.fontFamily),
                    color: getTextColorCss(settings.textColor),
                  }}
                />
              </div>
            ))}
            
            <button 
              onClick={addSection}
              disabled={script.sections.length >= MAX_SECTIONS}
              title={script.sections.length >= MAX_SECTIONS ? `Maximum 500 ${sectionLabel}s reached` : undefined}
              className="py-2 px-3 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus className="w-5 h-5" />
              Add {isPerformance ? 'Turn' : 'Section'}
            </button>
          </div>
        </div>
      </div>

      {showMarkdown && <MarkdownEditor key={script.id} script={script} onSave={onChange} onClose={() => setShowMarkdown(false)} />}
      <Dialog open={preflightIssues !== null} onOpenChange={open => { if (!open) setPreflightIssues(null); }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finish setting up your performance</DialogTitle>
            <DialogDescription>Resolve these items before rehearsal. Your dialogue is saved.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {preflightIssues?.map((issue, index) => <li key={index}>
              <button className="w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" onClick={() => {
                setPreflightIssues(null);
                if (issue.sectionId) requestAnimationFrame(() => {
                  const field = textareaRefs.current.get(issue.sectionId!);
                  field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  if (issue.focusDialogue) field?.focus();
                  else field?.closest('.group')?.querySelector<HTMLSelectElement>('select')?.focus();
                });
                else setShowActorPanel(true);
              }}>{issue.message} <span className="text-primary">Fix →</span></button>
            </li>)}
          </ul>
          <p className="text-xs text-muted-foreground">For a rehearsal without partner audio, switch it off in Scene Partner setup.</p>
        </DialogContent>
      </Dialog>
      {showActorPanel && (
        <ActorAuthoringPanel
          actor={script.actor}
          onChange={handleActorChange}
          onClose={() => setShowActorPanel(false)}
          onRehearse={() => void startReader()}
          sections={script.sections}
          onDeleteCharacter={handleDeleteCharacter}
        />
      )}
    </div>
  );
}
