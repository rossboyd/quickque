import { LicenceSettings } from './licence-settings';
import { useDebugLicence, setDebugLicensed } from '@/lib/debug-licence';
import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { 
  Settings as SettingsIcon, 
  Download, Upload, 
  Moon, Sun, Loader2, AlertCircle
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MAX_BACKUP_BYTES } from '@/lib/store-persistence';
import { downloadFile } from '@/lib/library-management';
import { isDesktop } from '@/lib/desktop';
import { AppearanceControls } from '@/components/appearance-controls';
import { PresentationControls } from '@/components/presentation-controls';
import { setFlowDebugVisible, useFlowDebugVisibility } from '@/lib/flow-debug-visibility';
import { AudioSetup } from './audio-setup';
import { VoiceFollowSetupButton } from './voice-follow-setup-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

export function SettingsDialog() {
  const {
    scripts,
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
    presentationDefaults,
    updatePresentationDefaults,
    resetPresentationDefaults,
  } = useStore();
  const referencedVoiceIds = scripts.flatMap(script => [
    ...(script.narratorVoice?.voiceId ? [script.narratorVoice.voiceId] : []),
    ...(script.actor?.characters.flatMap(character =>
      character.voice.voiceId ? [character.voice.voiceId] : [],
    ) ?? []),
  ]);
  
  const [open, setOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [debugPreferenceError, setDebugPreferenceError] = useState(false);
  const debugVisible = useFlowDebugVisibility();
  const debugLicence = useDebugLicence();
  const [licenceBusy, setLicenceBusy] = useState(false);
  const [licenceError, setLicenceError] = useState<string | null>(null);
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
          Settings
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[850px] w-[95vw] h-[min(85dvh,760px)] overflow-hidden flex flex-col bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription>Your workspace, reading preferences and local audio setup.</DialogDescription>
        </DialogHeader>
        
        {error && !importFailed && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <Tabs defaultValue="general" className="flex min-h-0 flex-col">
          <TabsList aria-label="Settings categories" className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent px-1 py-2">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="reading">Reading</TabsTrigger>
            <TabsTrigger value="audio">Voices & audio</TabsTrigger>
            <TabsTrigger value="storage">Storage & backups</TabsTrigger>
            <TabsTrigger value="help">Help & diagnostics</TabsTrigger>
          </TabsList>
<TabsContent value="general" className="min-h-0 overflow-y-auto space-y-6 py-4 pr-2"><LicenceSettings />          <div className="space-y-4">
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

          </div>

          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Appearance</h3>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.darkTheme ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
                <div>
                  <div className="font-medium">Dark Theme</div>
                  <div className="text-sm text-muted-foreground">Use a dark background in the editor</div>
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

            <AppearanceControls settings={settings} updateSettings={updateSettings} />
          </div>
          
</TabsContent>
<TabsContent value="reading" className="min-h-0 overflow-y-auto space-y-6 py-4 pr-2">

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Presentation Defaults</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  These layout settings apply to all future scripts. 
                  You can still override them per-script in the reader.
                </p>
              </div>
              {resetPresentationDefaults && (
                <button
                  type="button"
                  onClick={resetPresentationDefaults}
                  className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                >
                  Reset Defaults
                </button>
              )}
            </div>

            <div className="pt-2">
              <PresentationControls 
                value={presentationDefaults} 
                onChange={updatePresentationDefaults} 
              />
            </div>
          </div>
          
</TabsContent>
<TabsContent value="audio" className="min-h-0 overflow-y-auto space-y-6 py-4 pr-2"><AudioSetup referencedVoiceIds={referencedVoiceIds} /><VoiceFollowSetupButton /></TabsContent>
<TabsContent value="storage" className="min-h-0 overflow-y-auto space-y-6 py-4 pr-2"><section className="space-y-4"><h3 className="font-semibold">Script storage</h3>            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 pt-1">
                <div className="font-medium">Script folder</div>
                <div className="text-sm text-muted-foreground truncate" title={libraryDirectory || ''}>
                  {isDesktop() ? (libraryDirectory || 'Not selected') : 'This browser'}
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
                  Choose folder
                </button>
              )}
            </div>

</section>
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Script backups</h3>
            <p className="text-sm text-muted-foreground">
              Full backups include scripts, Trash, custom order and sorting preference, but not presentation settings, voice recordings, models or generated audio.
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
                Export script backup
              </button>
              <button type="button" disabled={reading || recoveryRequired} onClick={() => fileInput.current?.click()} className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors disabled:opacity-50">
                <Upload className="w-4 h-4" />
                {reading ? 'Reading…' : 'Import script backup'}
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

</TabsContent>
<TabsContent value="help" className="min-h-0 overflow-y-auto space-y-6 py-4 pr-2"><section className="space-y-3"><h3 className="font-semibold">Getting started</h3><p className="text-sm text-muted-foreground">Walk through script storage, optional voice setup and a first script.</p>            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event('quickque:welcome'));
              }}
              className="text-sm text-primary hover:underline font-medium"
            >
              Open welcome guide
            </button>
</section>

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



          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Diagnostics</h3>


            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Show audio & Voice Follow trace</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Show recording, generation, playback and Voice Follow checkpoints throughout the app. Diagnostics contain no audio or transcripts.
                </p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  aria-label="Show audio & Voice Follow trace"
                  className="sr-only peer"
                  checked={debugVisible}
                  onChange={event => {
                    setDebugPreferenceError(!setFlowDebugVisible(event.target.checked));
                  }}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
              </label>
            </div>
            {debugPreferenceError && (
              <p role="alert" className="text-sm text-destructive">
                Debug visibility will reset when Quickque closes because this preference could not be saved.
              </p>
            )}
          </div>

<details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Developer options</summary><div className="mt-4 space-y-3">            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Licence mode: {debugLicence.licensed ? 'Licensed' : 'Unlicensed'}</div>
                <p className="mt-1 text-sm text-muted-foreground">Temporary testing switch. Licensed unlocks unlimited Voice Follow and saved AI audio on Mac. Unlicensed uses the 30-second session allowance. No payment or licence is verified.</p>
              </div>
              <input type="checkbox" role="switch" aria-label="Licensed mode" checked={debugLicence.licensed} disabled={!debugLicence.loaded || licenceBusy} className="h-5 w-5 shrink-0 accent-primary" onChange={async event => {
                const licensed = event.target.checked;
                setLicenceBusy(true); setLicenceError(null);
                try { await setDebugLicensed(licensed); } catch (error) { setLicenceError(String(error)); }
                finally { setLicenceBusy(false); }
              }} />
            </div>
            {licenceError && <p role="alert" className="text-sm text-destructive">{licenceError}</p>}</div></details></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
