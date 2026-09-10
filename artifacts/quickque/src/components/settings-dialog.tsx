import { useState } from 'react';
import { useStore } from '@/lib/store';
import { 
  Settings as SettingsIcon, 
  Download, Upload, 
  Moon, Sun, MonitorUp
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function SettingsDialog() {
  const { settings, updateSettings, exportScripts, importScripts } = useStore();
  const [open, setOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors font-medium">
          <SettingsIcon className="w-5 h-5 opacity-70" />
          Settings
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings & Help</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          
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
                  accept=".json" 
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

          <div className="bg-accent/30 p-4 rounded-lg flex gap-3 text-sm">
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
