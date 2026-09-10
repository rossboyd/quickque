import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';
import { calculateWordCount, estimateTime, formatTime, generateId } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings-dialog';
import { 
  Plus, Search, MoreVertical, Play, 
  Trash2, Copy, FileText, GripVertical, 
  Settings as SettingsIcon, Trash, AlertTriangle, MonitorPlay, ChevronUp, ChevronDown
} from 'lucide-react';

export default function Library() {
  const { 
    scripts, 
    activeScriptId, 
    setActiveScriptId, 
    createScript, 
    updateScript, 
    deleteScript, 
    duplicateScript,
    error,
    clearError
  } = useStore();
  
  const [search, setSearch] = useState('');
  const [_, setLocation] = useLocation();

  const activeScript = scripts.find(s => s.id === activeScriptId);

  const filteredScripts = useMemo(() => {
    if (!search.trim()) return scripts;
    const lower = search.toLowerCase();
    return scripts.filter(s => s.title.toLowerCase().includes(lower));
  }, [scripts, search]);

  const handleCreate = () => {
    createScript();
    setSearch('');
  };

  const handlePresent = () => {
    if (activeScriptId) {
      setLocation(`/read/${activeScriptId}`);
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden selection:bg-primary/20">
      
      {/* SIDEBAR */}
      <div className="w-80 flex-shrink-0 border-r border-border bg-sidebar flex flex-col z-10 shadow-sm relative">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight text-sidebar-foreground flex items-center gap-2">
              <MonitorPlay className="w-5 h-5 text-primary" />
              Quickque
            </h1>
            <button 
              onClick={handleCreate}
              className="p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors"
              title="New Script"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search scripts..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-sidebar-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredScripts.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              {search ? 'No scripts found' : 'No scripts yet'}
            </div>
          ) : (
            filteredScripts.map(script => {
              const totalWords = script.sections.reduce((acc, sec) => acc + calculateWordCount(sec.content), 0);
              const timeSec = estimateTime(totalWords);
              const isActive = script.id === activeScriptId;
              
              return (
                <div 
                  key={script.id}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-sidebar-accent text-sidebar-foreground'}`}
                  onClick={() => setActiveScriptId(script.id)}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="font-medium truncate">{script.title || 'Untitled Script'}</div>
                    <div className={`text-xs mt-1 opacity-80 flex items-center gap-2`}>
                      <span>{totalWords} words</span>
                      <span>•</span>
                      <span>~{formatTime(timeSec)}</span>
                    </div>
                  </div>
                  
                  <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <ScriptMenu 
                      scriptId={script.id} 
                      onDuplicate={() => duplicateScript(script.id)}
                      onDelete={() => {
                        if (confirm('Are you sure you want to delete this script?')) {
                          deleteScript(script.id);
                        }
                      }}
                      isActive={isActive}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <SettingsDialog />
        </div>
      </div>

      {/* EDITOR */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
        {error && (
          <div className="absolute top-0 inset-x-0 p-3 bg-destructive/10 text-destructive text-sm flex items-center justify-between border-b border-destructive/20 z-50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            <button onClick={clearError} className="hover:underline">Dismiss</button>
          </div>
        )}

        {activeScript ? (
          <Editor 
            script={activeScript} 
            onChange={(updates) => updateScript(activeScript.id, updates)} 
            onPresent={handlePresent}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <FileText className="w-16 h-16 mb-4 opacity-20" />
            <h2 className="text-xl font-medium mb-2 text-foreground">No script selected</h2>
            <p className="text-sm">Select a script from the sidebar or create a new one.</p>
            <button 
              onClick={handleCreate}
              className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-md shadow hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Script
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

function ScriptMenu({ scriptId, onDuplicate, onDelete, isActive }: { scriptId: string, onDuplicate: () => void, onDelete: () => void, isActive: boolean }) {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="relative">
      <button 
        onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-md transition-colors ${isActive ? 'hover:bg-black/10' : 'hover:bg-black/5 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100'}`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-popover-border rounded-md shadow-lg z-50 py-1 text-popover-foreground">
            <button 
              onClick={() => { setOpen(false); onDuplicate(); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
            >
              <Copy className="w-4 h-4" /> Duplicate
            </button>
            <button 
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ script, onChange, onPresent }: { script: any, onChange: (u: any) => void, onPresent: () => void }) {
  const totalWords = script.sections.reduce((acc: number, sec: any) => acc + calculateWordCount(sec.content), 0);
  const timeSec = estimateTime(totalWords);

  const addSection = () => {
    onChange({
      sections: [...script.sections, { id: generateId(), title: 'New Section', content: '' }]
    });
  };

  const updateSection = (id: string, updates: any) => {
    onChange({
      sections: script.sections.map((s: any) => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const deleteSection = (id: string) => {
    if (script.sections.length <= 1) return;
    onChange({
      sections: script.sections.filter((s: any) => s.id !== id)
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-shrink-0 border-b border-border bg-background z-10 px-8 py-6">
        <div className="flex items-start justify-between gap-4 max-w-4xl mx-auto">
          <div className="flex-1 min-w-0">
            <input 
              type="text"
              value={script.title}
              onChange={e => onChange({ title: e.target.value })}
              className="w-full bg-transparent text-3xl font-bold text-foreground focus:outline-none placeholder:text-muted-foreground/50 truncate"
              placeholder="Script Title"
            />
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>{totalWords} words</span>
              <span>Estimated time: {formatTime(timeSec)}</span>
              <span>{script.sections.length} section{script.sections.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <button 
            onClick={onPresent}
            className="flex-shrink-0 flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-medium rounded-full shadow-lg shadow-primary/20 hover:bg-primary/90 hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            <Play className="w-5 h-5 fill-current" />
            Present
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6 pb-32">
          {script.sections.map((section: any, idx: number) => (
            <div key={section.id} className="group relative bg-card rounded-xl border border-card-border shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/40 transition-all">
              <div className="flex items-center justify-between p-3 border-b border-card-border bg-muted/30 rounded-t-xl">
                <div className="flex items-center flex-1 gap-2">
                  <div className="flex flex-col text-muted-foreground opacity-50">
                    <button 
                      onClick={() => moveSection(idx, -1)} 
                      disabled={idx === 0}
                      className="p-0.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => moveSection(idx, 1)} 
                      disabled={idx === script.sections.length - 1}
                      className="p-0.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={section.title}
                    onChange={e => updateSection(section.id, { title: e.target.value })}
                    className="flex-1 bg-transparent font-semibold text-foreground focus:outline-none px-2 py-1"
                    placeholder="Section Title"
                  />
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="text-xs text-muted-foreground font-mono bg-background px-2 py-1 rounded border">
                    {calculateWordCount(section.content)} w
                  </div>
                  {script.sections.length > 1 && (
                    <button 
                      onClick={() => deleteSection(section.id)}
                      className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                      title="Delete Section"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={section.content}
                onChange={e => updateSection(section.id, { content: e.target.value })}
                className="w-full bg-transparent text-foreground p-4 min-h-[160px] resize-y focus:outline-none leading-relaxed"
                placeholder="Type your script here..."
                style={{ fontSize: '1.05rem' }}
              />
            </div>
          ))}
          
          <button 
            onClick={addSection}
            className="w-full py-4 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            Add Section
          </button>
        </div>
      </div>
    </div>
  );
}
