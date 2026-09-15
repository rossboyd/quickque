import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { extractDocumentFile } from '@/lib/document-import/client';
import type { ExtractedDocument } from '@/lib/document-import/types';
import {
  assignImportTurn,
  acceptUnstructuredImport,
  createImportReviewDraft,
  mergeImportCharacter,
  splitUnstructuredImport,
  treatImportTurnAsDirection,
  treatImportTurnAsDialogue,
  validateImportReviewDraft,
  type ImportReviewDraft,
} from '@/lib/document-import/review';
import { useStore } from '@/lib/store';
import { AlertTriangle, Loader2, UploadCloud, Info, Users } from 'lucide-react';
import type { ScriptPurpose } from '@/lib/types';

export function DocumentImportDialog({ 
  open, 
  onOpenChange,
  onSuccess,
  externalFile,
  externalError,
  clearExternal
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  externalFile?: File | null;
  externalError?: string | null;
  clearExternal?: () => void;
}) {
  const { importDocument } = useStore();
  
  const [step, setStep] = useState<'idle' | 'extracting' | 'review'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedDocument | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [purpose, setPurpose] = useState<ScriptPurpose | null>(null);
  const [draft, setDraft] = useState<ImportReviewDraft | null>(null);
  const [saving, setSaving] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (open && step === 'idle') {
      if (externalError) {
        setError(externalError);
        if (clearExternal) clearExternal();
      } else if (externalFile) {
        processFile(externalFile);
        if (clearExternal) clearExternal();
      }
    }
  }, [open, externalFile, externalError, step, clearExternal]);

  const resetState = useCallback(() => {
    setStep('idle');
    setError(null);
    setFile(null);
    setExtracted(null);
    setTitle('');
    setText('');
    setPasteText('');
    setPurpose(null);
    setDraft(null);
    setSaving(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
      if (clearExternal) clearExternal();
    }
    onOpenChange(newOpen);
  };

  const processFile = async (selectedFile: File) => {
    setError(null);
    
    // Check file extension client side
    const validExtensions = ['.txt', '.md', '.markdown', '.docx', '.rtf', '.pdf'];
    const extension = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
    if (!validExtensions.includes(extension)) {
      setError(`Unsupported file type. Please select a .txt, .md, .docx, .rtf, or .pdf file.`);
      return;
    }

    setFile(selectedFile);
    setStep('extracting');
    
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    try {
      const result = await extractDocumentFile(selectedFile, controller.signal);
      
      if (controller.signal.aborted || abortControllerRef.current !== controller) {
        return;
      }
      
      setExtracted(result);
      setTitle(result.title.slice(0, 200));
      setText(result.text);
      setPurpose(null);
      setDraft(null);
      setStep('review');
    } catch (err: any) {
      if (controller.signal.aborted || abortControllerRef.current !== controller || err.name === 'AbortError') {
        return; // Cancelled or stale, do nothing
      }
      setError(err.message || 'Failed to extract document.');
      setStep('idle');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setError('Please select a single file.');
      return;
    }
    processFile(files[0]);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      
      if (step !== 'idle') return;
      
      const files = e.dataTransfer.files;
      if (files.length > 1) {
        setError('Please drop a single file. Multiple files are not supported.');
        return;
      }
      if (files.length === 1) {
        processFile(files[0]);
      }
    }
  };

  const handleCancelExtraction = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStep('idle');
    setFile(null);
  };

  const handleSave = () => {
    const finalTitle = title.trim();
    const finalText = text;
    
    if (!finalTitle) {
      setError('Title cannot be blank.');
      return;
    }
    if (!finalText.trim()) {
      setError('Document text cannot be blank.');
      return;
    }
    if (finalTitle.length > 200) {
      setError('Title exceeds maximum length of 200 characters.');
      return;
    }
    if (finalText.length > 500000) {
      setError('Text exceeds maximum length of 500000 characters.');
      return;
    }

    if (!purpose || !draft) {
      setError('Choose whether this is a performance or presentation, then review the structure.');
      return;
    }
    setSaving(true);
    const result = importDocument({ ...draft, title: finalTitle, purpose });
    if (result.ok) {
      onSuccess();
      handleOpenChange(false);
    } else {
      setError(result.error || 'Failed to save document.');
      setSaving(false);
    }
  };

  const choosePurpose = (nextPurpose: ScriptPurpose) => {
    if (!extracted) return;
    setPurpose(nextPurpose);
    setDraft(createImportReviewDraft({
      title,
      text,
      fileName: file?.name ?? 'Pasted content',
      format: extracted.format,
      warnings: extracted.warnings,
      purpose: nextPurpose,
    }));
    setError(null);
  };

  const reviewPaste = () => {
    if (!pasteText.trim()) {
      setError('Paste some script text before reviewing it.');
      return;
    }
    const pasted: ExtractedDocument = { title: 'Pasted script', text: pasteText, format: 'txt', warnings: [] };
    setFile(null);
    setExtracted(pasted);
    setTitle(pasted.title);
    setText(pasteText);
    setPurpose(null);
    setDraft(null);
    setError(null);
    setStep('review');
  };
  const draftValidationError = draft ? validateImportReviewDraft(draft) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-[600px] flex flex-col max-h-[90vh]"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DialogHeader>
          <DialogTitle>Import Document</DialogTitle>
          <DialogDescription>
            {step === 'idle' && "Select a local file (max 10MB) to import. Processing happens locally—no data is uploaded. Quickque Markdown preserves script structure; other document formats are converted to plain text. PDF extraction may vary and requires layout review."}
            {step === 'extracting' && `Extracting plain text from ${file?.name}...`}
            {step === 'review' && "Confirm the type, then review the detected cast, turns, dialogue and writer directions before saving."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md flex items-start gap-2 text-sm" role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {step === 'idle' && (
          <div className="space-y-4">
          <div 
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Select a file to import or drag and drop here"
          >
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".txt,.md,.markdown,.pdf,.docx,.rtf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf"
              className="hidden" 
              aria-hidden="true"
            />
            <UploadCloud className={`w-12 h-12 mb-4 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
            <h3 className="text-lg font-medium mb-1">Click to upload or drag and drop</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
               TXT, Markdown, DOCX, RTF or PDF. Processed locally.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" /><span>or paste content</span><span className="h-px flex-1 bg-border" />
          </div>
          <textarea
            value={pasteText}
            onChange={event => setPasteText(event.target.value)}
            className="min-h-28 w-full rounded-md border border-border bg-background p-3 text-sm"
            placeholder="Paste a scene or presentation here…"
            aria-label="Paste script content"
            maxLength={500000}
          />
          <button onClick={reviewPaste} disabled={!pasteText.trim()} className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50">
            Review pasted content
          </button>
          </div>
        )}

        {step === 'extracting' && (
          <div className="flex flex-col items-center justify-center py-12 text-center" role="status" aria-live="polite">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-medium mb-2">Extracting text...</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Reading {file?.name}
            </p>
            <button 
              onClick={handleCancelExtraction}
              className="px-4 py-2 border border-border rounded-md hover:bg-accent transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'review' && extracted && (
          <div className="flex flex-col flex-1 min-h-0 space-y-4 overflow-y-auto pr-2">
            {(extracted.format !== 'txt' && extracted.format !== 'md' || extracted.warnings.length > 0) && (
              <div className="bg-muted/50 border border-border rounded-md p-3 text-sm flex gap-2 items-start text-muted-foreground">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p>
                    <strong className="font-medium text-foreground">Note:</strong> Formatting, images, and layout are removed during extraction.
                  </p>
                  {extracted.warnings.map((warning, i) => (
                    <p key={i} className="text-destructive">{warning}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="import-title" className="text-sm font-medium">Script Title</label>
              <input
                id="import-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Enter title..."
                aria-invalid={!title.trim() || title.length > 200}
                aria-label="Review and edit the script title"
              />
              <div className="text-xs text-muted-foreground text-right">
                {title.length}/200
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">What are you preparing?</div>
              <div className="grid grid-cols-2 gap-3">
                {(['performance', 'presentation'] as const).map(option => (
                  <button key={option} onClick={() => choosePurpose(option)} className={`rounded-lg border p-3 text-left ${purpose === option ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}>
                    <span className="block font-medium">{option === 'performance' ? 'Performance / scene' : 'Presentation'}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{option === 'performance' ? 'Review speakers and turns' : 'Keep as continuous text'}</span>
                  </button>
                ))}
              </div>
            </div>

            {draft && (
              <>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <strong>Source:</strong> {draft.provenance.fileName} · {draft.provenance.format.toUpperCase()} · {draft.provenance.originalText.length.toLocaleString()} characters
                  <details className="mt-2">
                    <summary className="cursor-pointer text-primary">View original extracted content</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">{draft.provenance.originalText}</pre>
                  </details>
                </div>
                {draft.issues.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <strong>Needs review</strong>
                    {draft.issues.map(issue => <p key={`${issue.sectionId}-${issue.line}`}>Line {issue.line}: {issue.message}</p>)}
                  </div>
                )}
                {purpose === 'performance' && draftValidationError && draft.issues.length === 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <strong>Needs review:</strong> {draftValidationError}
                  </div>
                )}
                {purpose === 'performance' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> Cast ({draft.characters.length}) · Turns ({draft.sections.length})</div>
                    <button
                      onClick={() => {
                        const number = draft.characters.length + 1;
                        setDraft({
                          ...draft,
                          characters: [...draft.characters, {
                            id: `manual-character-${Date.now()}-${number}`,
                            name: `Character ${number}`,
                            age: '',
                            gender: '',
                            style: '',
                            voice: { engine: 'turbo', voiceId: '', rate: 1 },
                          }],
                        });
                      }}
                      className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                    >
                      Add character
                    </button>
                    {!draft.structured && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button onClick={() => setDraft(splitUnstructuredImport(draft))} className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
                          Split into paragraph turns
                        </button>
                        <button onClick={() => setDraft(acceptUnstructuredImport(draft))} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
                          Use as one turn
                        </button>
                      </div>
                    )}
                    {draft.characters.map(character => (
                      <div key={character.id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto]">
                        <input
                          value={character.name}
                          aria-label={`Character name ${character.name}`}
                          onChange={event => setDraft({
                            ...draft,
                            characters: draft.characters.map(item => item.id === character.id ? { ...item, name: event.target.value } : item),
                          })}
                          className="rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                        {draft.characters.length > 1 && (
                          <select
                            aria-label={`Merge ${character.name}`}
                            value=""
                            onChange={event => event.target.value && setDraft(mergeImportCharacter(draft, character.id, event.target.value))}
                            className="rounded border border-border bg-background px-2 py-1 text-xs"
                          >
                            <option value="">Merge into…</option>
                            {draft.characters.filter(item => item.id !== character.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                    <div className="space-y-2">
                      {draft.sections.map((section, index) => (
                        <div key={section.id} className="rounded-md border border-border p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <strong className="text-sm">Turn {index + 1}</strong>
                            <select
                              value={section.characterId ?? ''}
                              onChange={event => setDraft(assignImportTurn(draft, section.id, event.target.value || null))}
                              aria-label={`Speaker for turn ${index + 1}`}
                              className="rounded border border-border bg-background px-2 py-1 text-sm"
                            >
                              <option value="">Unassigned</option>
                              {draft.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                            </select>
                          </div>
                          {section.sourceCue && (
                            <div className="mb-2 flex flex-wrap gap-3">
                              <button onClick={() => setDraft(treatImportTurnAsDialogue(draft, section.id))} className="text-xs text-primary underline underline-offset-2">
                                Treat cue as dialogue
                              </button>
                              <button onClick={() => setDraft(treatImportTurnAsDirection(draft, section.id))} className="text-xs text-primary underline underline-offset-2">
                                Treat cue as writer direction
                              </button>
                            </div>
                          )}
                          {section.notes && <p className="mb-2 text-xs italic text-muted-foreground">Direction: {section.notes}</p>}
                          <p className="whitespace-pre-wrap text-sm">{section.content || <span className="text-muted-foreground">No dialogue on this turn</span>}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {purpose === 'presentation' && (
                  <div className="rounded-md border border-border p-3">
                    <div className="mb-2 text-sm font-medium">Presentation content</div>
                    <p className="whitespace-pre-wrap text-sm">{draft.sections[0]?.content}</p>
                  </div>
                )}
              </>
            )}
            {!draft && (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Choose a type to build the review. Quickque will not guess silently.
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="import-text" className="text-xs text-muted-foreground">Extracted source reference</label>
              <textarea id="import-text" value={text} readOnly className="sr-only" aria-label="Review and edit the extracted plain text" />
            </div>
          </div>
        )}

        {step === 'review' && (
          <DialogFooter className="mt-4 pt-4 border-t border-border sm:justify-end">
            <button
              onClick={() => handleOpenChange(false)}
              className="px-4 py-2 text-sm font-medium hover:bg-accent rounded-md transition-colors mr-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || !text.trim() || !purpose || !draft || saving || Boolean(draftValidationError)}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : purpose === 'performance' ? 'Save and continue to setup' : 'Save presentation'}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
