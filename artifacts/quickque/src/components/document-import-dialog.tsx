import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { extractDocumentFile } from '@/lib/document-import/client';
import type { ExtractedDocument } from '@/lib/document-import/types';
import { useStore } from '@/lib/store';
import { AlertTriangle, Loader2, UploadCloud, Info } from 'lucide-react';

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

    const result = importDocument(finalTitle, finalText, extracted?.format === 'md' ? 'markdown' : 'plain');
    if (result.ok) {
      onSuccess();
      handleOpenChange(false);
    } else {
      setError(result.error || 'Failed to save document.');
    }
  };

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
            {step === 'review' && "Review and edit the extracted text. Save when you're ready to create the script."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md flex items-start gap-2 text-sm" role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {step === 'idle' && (
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

            <div className="space-y-2 flex-1 flex flex-col min-h-[200px]">
              <label htmlFor="import-text" className="text-sm font-medium flex justify-between">
                <span>Extracted Text</span>
                <span className="text-muted-foreground text-xs font-normal">Plain text only</span>
              </label>
              <textarea
                id="import-text"
                value={text}
                onChange={e => setText(e.target.value)}
                maxLength={500000}
                className="w-full flex-1 min-h-[200px] p-3 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y leading-relaxed font-sans text-base"
                placeholder="Document text..."
                aria-invalid={!text.trim() || text.length > 500000}
                aria-label="Review and edit the extracted plain text"
              />
              <div className="text-xs text-muted-foreground text-right mt-1">
                {text.length}/500000
              </div>
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
              disabled={!title.trim() || !text.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Save as Script
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
