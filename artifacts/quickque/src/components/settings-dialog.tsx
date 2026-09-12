import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { 
  Settings as SettingsIcon, 
  Download, Upload, 
  Moon, Sun, MonitorUp, Loader2, AlertCircle
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MAX_BACKUP_BYTES } from '@/lib/store-persistence';
import { downloadFile } from '@/lib/library-management';
import { isDesktop } from '@/lib/desktop';
import { AppearanceControls } from '@/components/appearance-controls';

export function SettingsDialog() {
  const {
    settings,
    updateSettings,
    exportScripts,
    importScripts,
    error,
    recoveryRequired,
    profile,
    updateProfile,
    libraryDirectory,
    chooseLibraryDirectory,
    localSaveStatus,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleChooseFolder = async () => {
    try {
      setFolderLoading(true);
      setFolderError(null);
      await chooseLibraryDirectory();
    } catch (chooseError) {
      setFolderError(
        chooseError instanceof Error
          ? chooseError.message
          : 'Could not choose a local library',
      );
    } finally {
      setFolderLoading(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportStatus(null);
    setImportFailed(false);
    if (file.size > MAX_BACKUP_BYTES) {
      setImportStatus('Backup is too large. The maximum size is 20 MB.');
      return;
    }
    setReading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setReading(false);
      const content = event.target?.result as string;
      const success = importScripts(content);
      if (success) {
        setImportStatus('Successfully imported backup. Existing scripts were kept.');
      } else {
        setImportFailed(true);
        setImportStatus('Backup was not imported. No scripts were changed.');
      }
    };
    reader.onerror = () => {
      setReading(false);
      setImportStatus('Could not read this file. Please choose it again.');
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    const data = exportScripts();
    downloadFile(`quickque-backup-${new Date().toISOString().split('T')[0]}.json`, data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors font-medium">
          <SettingsIcon className="w-5 h-5 opacity-70" />
          Settings & backups
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings & Help</DialogTitle>
          <DialogDescription>Device preferences, library backups and presentation shortcuts.</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {error && !importFailed && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Profile</h3>

            <div className="flex items-center justify-between gap-4">
              <label htmlFor="settings-name-input" className="block min-w-0">
                <div className="font-medium">Name</div>
                <div className="text-sm text-muted-foreground">Personalize your experience</div>
              </label>
              <input
                id="settings-name-input"
                type="text"
                value={profile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
                className="bg-background border border-border rounded-md px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                placeholder="Your name"
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 pt-1">
                <div className="font-medium">Library Location</div>
                <div className="text-sm text-muted-foreground truncate" title={libraryDirectory || ''}>
                  {isDesktop() ? (libraryDirectory || 'Not selected') : 'Browser Storage'}
                </div>
                {isDesktop() && localSaveStatus && (
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    Save status: {localSaveStatus}
                  </div>
                )}
                {folderError && (
                  <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {folderError}
                  </div>
                )}
              </div>
              {isDesktop() && (
                <button
                  type="button"
                  onClick={handleChooseFolder}
                  disabled={folderLoading}
                  className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground text-sm font-medium rounded hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {folderLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  Change Folder
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event('quickque:welcome'));
              }}
              className="text-sm text-primary hover:underline font-medium"
            >
              Reopen Welcome Guide
            </button>
          </div>

          <hr className="border-border" />
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Appearance</h3>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.darkTheme ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
                <div>
                  <div className="font-medium">Dark Theme</div>
                  <div className="text-sm text-muted-foreground">Better for teleprompter contrast</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  aria-label="Dark Theme"
                  className="sr-only peer" 
                  checked={settings.darkTheme}
                  onChange={(e) => updateSettings({ darkTheme: e.target.checked })}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Overlay Opacity</div>
                <div className="text-sm text-muted-foreground">Background visibility in compact mode</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono w-8 text-right">{settings.backgroundOpacity}%</span>
                <input 
                  type="range"
                  aria-label="Overlay Opacity"
                  min="0"
                  max="100"
                  value={settings.backgroundOpacity}
                  onChange={(e) => updateSettings({ backgroundOpacity: parseInt(e.target.value) })}
                  className="w-24 accent-primary"
                />
              </div>
            </div>

            <AppearanceControls settings={settings} updateSettings={updateSettings} />
          </div>
          
          <hr className="border-border" />
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Data</h3>
            <p className="text-sm text-muted-foreground">
              Full backups include scripts, Trash, custom order and sorting preference, but not presentation settings.
              Import Backup adds scripts and Trash without replacing existing items or changing your current sort.
              For TXT, PDF, DOCX or RTF files, use Import Document in the library.
            </p>
            
            <div className="flex flex-col sm:flex-row items-stretch justify-between gap-3">
              <button 
                onClick={handleExport}
                disabled={recoveryRequired}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export Full Backup
              </button>
              <button type="button" disabled={reading || recoveryRequired} onClick={() => fileInput.current?.click()} className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors disabled:opacity-50">
                <Upload className="w-4 h-4" />
                {reading ? 'Reading…' : 'Import Backup JSON'}
              </button>
                <input 
                  ref={fileInput}
                  type="file" 
                  accept=".json,application/json"
                  aria-label="Choose Quickque backup JSON"
                  className="hidden" 
                  onChange={handleImport}
                />
            </div>
            {importStatus && (
              <div role="status" className={`text-sm p-2 rounded ${importStatus.includes('Success') ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>
                {importStatus}
                {importFailed && error && <p className="mt-1">{error}</p>}
              </div>
            )}
          </div>

          <hr className="border-border" />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Play / Pause</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Space</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Exit Reader</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Esc</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Next Section</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Right ➔</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Prev Section</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Left ⬅</kbd>
              </div>
            </div>
          </div>

          <div className="bg-accent/30 p-4 rounded-lg flex gap-3 text-sm">
            <MonitorUp className="w-5 h-5 text-accent-foreground shrink-0" />
            <div>
              <p className="font-medium text-foreground mb-1">Desktop Capability</p>
              <p className="text-muted-foreground leading-relaxed">
                Native transparency, global keyboard shortcuts, and Local Phone Remote hosting require the desktop app. The browser remains available as a manual teleprompter, and "Compact Overlay Mode" is confined to this window. For screen sharing, share only your specific app windows, not your whole screen, to prevent Quickque from being recorded.
              </p>
            </div>
          </div>
          
        </div>
      </DialogContent>
    </Dialog>
  );
}
/*
export function SettingsDialog() {
  const {
    settings, updateSettings, exportScripts, importScripts,
    profile, updateProfile, libraryDirectory, chooseLibraryDirectory,
    localSaveStatus
  } = useStore();
  const [open, setOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const handleChooseFolder = async () => {
    try {
      setFolderLoading(true);
      setFolderError(null);
      await chooseLibraryDirectory();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : 'Failed to choose folder');
    } finally {
      setFolderLoading(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const success = importScripts(content);
      if (success) {
        setImportStatus('Successfully imported scripts!');
        setTimeout(() => setImportStatus(null), 3000);
      } else {
        setImportStatus('Failed to import. Invalid format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExport = () => {
    const data = exportScripts();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quickque-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors font-medium">
          <SettingsIcon className="w-5 h-5 opacity-70" />
          Settings
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings & Help</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Profile</h3>

            <div className="flex items-center justify-between gap-4">
              <label htmlFor="settings-name-input" className="block min-w-0">
                <div className="font-medium">Name</div>
                <div className="text-sm text-muted-foreground">Personalize your experience</div>
              </label>
              <input
                id="settings-name-input"
                type="text"
                value={profile?.name || ''}
                onChange={(e) => updateProfile({ name: e.target.value })}
                className="bg-background border border-border rounded-md px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                placeholder="Your name"
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 pt-1">
                <div className="font-medium">Library Location</div>
                <div className="text-sm text-muted-foreground truncate" title={libraryDirectory || ''}>
                  {isDesktop() ? (libraryDirectory || 'Not selected') : 'Browser Storage'}
                </div>
                {isDesktop() && localSaveStatus && (
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    Save status: {localSaveStatus}
                  </div>
                )}
                {folderError && (
                  <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {folderError}
                  </div>
                )}
              </div>
              {isDesktop() && (
                <button
                  onClick={handleChooseFolder}
                  disabled={folderLoading}
                  className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground text-sm font-medium rounded hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {folderLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  Change Folder
                </button>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event('quickque:welcome'));
                }}
                className="text-sm text-primary hover:underline font-medium"
              >
                Reopen Welcome Guide
              </button>
            </div>
          </div>

          <hr className="border-border" />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Voice Follow</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Voice Follow uses Apple’s on-device SpeechAnalyzer and SpeechTranscriber on macOS Tahoe 26 or later with Apple Silicon.
              Apple manages its language assets; Quickque downloads them only after you choose the download action, when needed.
              Audio stays on your Mac with no cloud fallback.
            </p>
          </div>

          <hr className="border-border" />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Appearance</h3>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.darkTheme ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
                <div>
                  <div className="font-medium">Dark Theme</div>
                  <div className="text-sm text-muted-foreground">Better for teleprompter contrast</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={settings.darkTheme}
                  onChange={(e) => updateSettings({ darkTheme: e.target.checked })}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Overlay Opacity</div>
                <div className="text-sm text-muted-foreground">Background visibility in compact mode</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono w-8 text-right">{settings.backgroundOpacity}%</span>
                <input 
                  type="range"
                  min="0"
                  max="100"
                  value={settings.backgroundOpacity}
                  onChange={(e) => updateSettings({ backgroundOpacity: parseInt(e.target.value) })}
                  className="w-24 accent-primary"
                />
              </div>
            </div>
          </div>
          
          <hr className="border-border" />
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Data</h3>
            
            <div className="flex items-center justify-between gap-4">
              <button 
                onClick={handleExport}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
              >
                <Download className="w-4 h-4" />
                Backup JSON
              </button>
              <label className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors cursor-pointer">
                <Upload className="w-4 h-4" />
                Restore JSON
                <input 
                  type="file" 
                  accept=".json,.bak"
                  className="hidden" 
                  onChange={handleImport}
                />
              </label>
            </div>
            {importStatus && (
              <div className={`text-sm p-2 rounded ${importStatus.includes('Success') ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>
                {importStatus}
              </div>
            )}
          </div>

          <hr className="border-border" />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Play / Pause</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Space</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Exit Reader</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Esc</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Next Section</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Right ➔</kbd>
              </div>
              <div className="flex justify-between p-2 bg-muted/50 rounded">
                <span>Prev Section</span>
                <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border border-border shadow-sm">Left ⬅</kbd>
              </div>
            </div>
          </div>

          <div className="bg-accent/30 p-4 rounded-lg flex gap-3 text-sm mt-4">
            <MonitorUp className="w-5 h-5 text-accent-foreground shrink-0" />
            <div>
              <p className="font-medium text-foreground mb-1">Desktop Capability</p>
              <p className="text-muted-foreground leading-relaxed">
                Native transparency and global keyboard shortcuts require the desktop app. If you're using this in a browser, "Compact Overlay Mode" will be confined to this window. For screen sharing, share only your specific app windows, not your whole screen, to prevent Quickque from being recorded.
              </p>
            </div>
          </div>
          
        </div>
      </DialogContent>
    </Dialog>
  );
}
*/
