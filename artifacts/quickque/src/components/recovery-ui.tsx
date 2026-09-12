import { useState, useRef } from 'react';
import { AlertTriangle, Download, RefreshCw, Upload } from 'lucide-react';
import { downloadFile } from '@/lib/library-management';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { MAX_BACKUP_BYTES } from '@/lib/store-persistence';

interface RecoveryUIProps {
  error: string | null;
  recoveryData: string | null;
  retryLoadLibrary: () => void;
  recoverLibrary: (data: string) => boolean;
}

export function RecoveryUI({ error, recoveryData, retryLoadLibrary, recoverLibrary }: RecoveryUIProps) {
  const [recoveryFileContent, setRecoveryFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BACKUP_BYTES) {
      setFileError('Backup file is too large (max 20MB).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (re) => {
      setRecoveryFileContent(re.target?.result as string);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => {
      setFileError('Failed to read file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col items-center min-h-[100dvh] w-full bg-background p-4 sm:p-6 overflow-y-auto">
      <AlertDialog open={recoveryFileContent !== null} onOpenChange={(open) => !open && setRecoveryFileContent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace Entire Library?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently overwrite your current library with the uploaded backup. This action cannot be undone. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md" role="alert">
              {error}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (recoveryFileContent !== null) {
                  const success = recoverLibrary(recoveryFileContent);
                  if (success) {
                    setRecoveryFileContent(null);
                  }
                }
              }}
            >
              Replace Library
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-xl w-full my-auto bg-destructive/5 border-2 border-destructive/20 rounded-xl p-4 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2" role="alert">
          <AlertTriangle className="w-12 h-12 text-destructive mb-2" aria-hidden="true" />
          <h2 className="text-2xl font-semibold text-destructive">Unable to Load Library</h2>
          <p className="text-muted-foreground">
            We could not read your library. Its stored data has not been replaced.
            You can download your raw data backup, retry loading, or recover by replacing the library with a valid backup file.
          </p>
        </div>


        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md" role="alert">
            {error}
          </div>
        )}
        
        {fileError && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md" role="alert">
            {fileError}
          </div>
        )}

        <div className="grid gap-3">
          {recoveryData !== null && (
            <button 
              onClick={() => downloadFile('quickque-recovery.json', recoveryData)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-background border border-border rounded-lg hover:bg-accent transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Download className="w-5 h-5" />
              Download Raw Data Backup
            </button>
          )}
          
          <button 
            onClick={retryLoadLibrary}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <RefreshCw className="w-5 h-5" />
            Retry Loading
          </button>
        </div>

        <div className="pt-6 border-t border-border mt-4">
          <h3 className="text-sm font-medium mb-2">Restore from a backup file</h3>
          <p className="text-xs text-muted-foreground mb-4">
            If you have a previously exported .json backup, you can replace your corrupted library with it. This will overwrite any remaining data.
          </p>
          <input 
            type="file" 
            accept=".json" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileChange}
            aria-label="Upload backup file"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
          >
            <Upload className="w-5 h-5" />
            Replace Library
          </button>
        </div>
      </div>
    </div>
  );
}
