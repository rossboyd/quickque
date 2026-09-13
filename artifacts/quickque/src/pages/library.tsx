import './workspace.css';
import { createVoiceLibrary } from '@/lib/voice-library';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';
import { calculateWordCount, estimateTime, formatTime, cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings-dialog';
import { DocumentImportDialog } from '@/components/document-import-dialog';
import { getVisibleScripts, downloadFile } from '@/lib/library-management';
import { getScriptPurpose, getPerformanceSummary, getSceneSetupIssues } from '@/lib/script-purpose';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SortMode, Script } from '@/lib/types';
import { Editor } from '@/components/editor';
import { RecoveryUI } from '@/components/recovery-ui';
import { BrandMark } from '@/components/brand-mark';
import { 
  Plus, Search, MoreVertical, 
  Trash2, Copy, FileText, 
  Trash, AlertTriangle, MonitorPlay,
  FileUp, ArrowUpDown, Edit2, Code, ArrowUp, ArrowDown, ChevronDown,
  RotateCcw, X, Play, Home,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
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
import { tokenize } from '@/lib/flow/tokenize';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { FlowSetupWizard } from '@/components/flow-setup-wizard';
import { isDesktop } from '@/lib/desktop';

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest First',
  oldest: 'Oldest First',
  az: 'Title A-Z',
  za: 'Title Z-A',
  custom: 'Custom Order'
};

export default function Library() {
  const store = useStore();
  const { 
    scripts, activeScriptId, setActiveScriptId,
    settings,
    createScript, updateScript, duplicateScript,
    error, clearError, profile,
    trash, sortMode, customOrder,
    setSortMode, reorderScripts,
    deleteScripts, restoreScripts, permanentlyDeleteScripts,
    exportScripts, recoveryData, recoveryRequired,
    recoverLibrary, retryLoadLibrary
  } = store;
  
  const [search, setSearch] = useState('');
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creatingSample, setCreatingSample] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [droppedError, setDroppedError] = useState<string | null>(null);
  const [location, setLocation] = useLocation();
  const isHome = location !== '/edit';
  const [showWizard, setShowWizard] = useState(false);
  const voiceLibrary = useMemo(() => createVoiceLibrary(), []);

  useEffect(() => {
    if (isDesktop()) {
      const seen = localStorage.getItem('quickque-first-launch-seen');
      const done = localStorage.getItem('quickque-flow-setup-done');
      if (!seen && !done) {
        setShowWizard(true);
      }
    }
  }, []);

  const setupTokens = useMemo(() => {
    let globalIdx = 0;
    return tokenize("Testing microphone permissions for Quickque Voice Follow.").map(t => ({
      ...t,
      sectionIdx: 0,
      globalTokenIdx: globalIdx++
    }));
  }, []);

  const setupFlow = useLocalFlow({ tokens: setupTokens, enabled: showWizard });

  const [viewMode, setViewMode] = useState<'library' | 'trash'>(location === '/trash' ? 'trash' : 'library');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{type: 'trash' | 'restore' | 'permanent', ids: string[]} | null>(null);
  const isMobileEditorOpen = !isHome;
  const setIsMobileEditorOpen = (open: boolean) => setLocation(open ? '/edit' : '/');
  const [homeIssues, setHomeIssues] = useState<{ script: Script; messages: string[] } | null>(null);
  const [checkingScript, setCheckingScript] = useState<string | null>(null);
  const playGeneration = useRef(0);
  const latestScripts = useRef(scripts);
  latestScripts.current = scripts;
  useEffect(() => () => { playGeneration.current += 1; }, []);
  useEffect(() => { setViewMode(location === '/trash' ? 'trash' : 'library'); }, [location]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    // Guard all window file drops against browser navigation
    const preventDefault = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const handleLibraryDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      if (isImportOpen || recoveryRequired) return;

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      
      setIsImportOpen(true);
      if (files.length > 1) {
        setDroppedFile(null);
        setDroppedError('Please drop a single file. Multiple files are not supported.');
      } else {
        setDroppedError(null);
        setDroppedFile(files[0]);
      }
    }
  };

  const activeScript = scripts.find(s => s.id === activeScriptId);
  const hasOnlySeed = scripts.length === 1 && scripts[0].id === 'seed-1';
  const showBanner = profile?.onboardingComplete && hasOnlySeed;

  const visibleItems = useMemo(() => {
    const sourceList = viewMode === 'library' ? scripts : trash.map(t => t.script);
    return getVisibleScripts(
      sourceList,
      search,
      viewMode === 'library' ? sortMode : 'newest',
      viewMode === 'library' ? customOrder : []
    );
  }, [scripts, trash, search, sortMode, customOrder, viewMode]);

  const handleCreate = () => setShowCreate(true);

  const createWithPurpose = (purpose: 'presentation' | 'performance') => {
    setViewMode('library');
    const res = createScript(purpose);
    if (res) setShowCreate(false);
    setSearch('');
    if (res) setIsMobileEditorOpen(true);
  };

  const createSample = async () => {
    if (creatingSample) return;
    setCreatingSample(true);
    try {
      // Discover approved local cloned voices only; never start speech here.
      const voices = (await voiceLibrary.list().catch(() => [])).map(voice => ({
        id: voice.referenceId, name: voice.name, language: 'en', engine: 'turbo' as const,
      }));
      const id = createScript('performance', { kind: 'matilda', voices });
      if (id) {
        setViewMode('library');
        setSearch('');
        setShowCreate(false);
        setIsMobileEditorOpen(true);
      }
    } finally { setCreatingSample(false); }
  };

  const handleDuplicate = (id: string) => {
    const res = duplicateScript(id);
    if (res) setIsMobileEditorOpen(true);
  };

  const handleOpenScript = (id: string) => {
    setActiveScriptId(id);
    setIsMobileEditorOpen(true);
  };

  const playFromHome = async (script: Script) => {
    const generation = ++playGeneration.current;
    setCheckingScript(script.id);
    try {
      let issues = getSceneSetupIssues(script);
      const needsVoices = script.actor?.enabled && script.sections.some(section => section.characterId && !script.actor!.myRoleIds.includes(section.characterId));
      if (!issues.length && getScriptPurpose(script) === 'performance' && needsVoices) {
        const voices = (await voiceLibrary.list()).map(voice => voice.referenceId);
        issues = getSceneSetupIssues(script, new Set(voices));
      }
      if (generation !== playGeneration.current || latestScripts.current.find(item => item.id === script.id) !== script) return;
      if (issues.length) { setHomeIssues({ script, messages: issues.map(issue => issue.message) }); return; }
      setActiveScriptId(script.id);
      setLocation(`/read/${script.id}`);
    } catch {
      if (generation === playGeneration.current) setHomeIssues({ script, messages: ['Could not check local voices. Open the editor and check Scene Partner setup.'] });
    } finally { if (generation === playGeneration.current) setCheckingScript(null); }
  };

  const handlePresent = () => {
    if (activeScriptId) {
      setLocation(`/read/${activeScriptId}`);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== id && sortMode === 'custom' && !search) {
      setDragOverId(id);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetId && viewMode === 'library' && sortMode === 'custom' && !search) {
      const newOrder = [...visibleItems.map(s => s.id)];
      const from = newOrder.indexOf(draggedId);
      const to = newOrder.indexOf(targetId);
      if (from !== -1 && to !== -1) {
        newOrder.splice(from, 1);
        newOrder.splice(to, 0, draggedId);
        reorderScripts(newOrder);
      }
    }
    handleDragEnd();
  };

  const scriptMenu = (script: Script, idx: number) => {
    const isActive = script.id === activeScriptId;
    const isDraggable = sortMode === 'custom' && !search && viewMode === 'library';
    return (<ScriptMenu
                      viewMode={viewMode}
                      isActive={isActive}
                      scriptTitle={script.title || 'Untitled Script'}
                      onRename={() => setEditingId(script.id)}
                      onDuplicate={() => handleDuplicate(script.id)}
                      onDelete={() => setConfirmAction({ type: 'trash', ids: [script.id] })}
                      onRestore={() => setConfirmAction({ type: 'restore', ids: [script.id] })}
                      onPermanentDelete={() => setConfirmAction({ type: 'permanent', ids: [script.id] })}
                      onExportJSON={() => {
                        const data = exportScripts([script.id], 'json');
                        downloadFile(`${script.title || 'script'}.json`, data);
                      }}
                      onExportTXT={() => {
                        const data = exportScripts([script.id], 'txt');
                        downloadFile(`${script.title || 'script'}.txt`, data, 'text/plain');
                      }}
                      canMoveUp={isDraggable && idx > 0}
                      canMoveDown={isDraggable && idx < visibleItems.length - 1}
                      onMoveUp={() => {
                        const newOrder = [...visibleItems.map(s => s.id)];
                        const temp = newOrder[idx];
                        newOrder[idx] = newOrder[idx - 1];
                        newOrder[idx - 1] = temp;
                        reorderScripts(newOrder);
                      }}
                      onMoveDown={() => {
                        const newOrder = [...visibleItems.map(s => s.id)];
                        const temp = newOrder[idx];
                        newOrder[idx] = newOrder[idx + 1];
                        newOrder[idx + 1] = temp;
                        reorderScripts(newOrder);
                      }}
                    />);
  };

  if (recoveryRequired) {
    return (
      <RecoveryUI 
        error={error} 
        recoveryData={recoveryData} 
        retryLoadLibrary={retryLoadLibrary} 
        recoverLibrary={recoverLibrary} 
      />
    );
  }

  return (
    <div 
      className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden selection:bg-primary/20"
      onDragOver={e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
        }
      }}
      onDrop={handleLibraryDrop}
    >
      {showWizard && (
        <FlowSetupWizard
          flow={setupFlow}
          onComplete={() => {
            localStorage.setItem('quickque-first-launch-seen', 'true');
            localStorage.setItem('quickque-flow-setup-done', 'true');
            setShowWizard(false);
            setupFlow.stop();
          }}
          onCancel={() => {
            localStorage.setItem('quickque-first-launch-seen', 'true');
            setShowWizard(false);
            setupFlow.stop();
          }}
        />
      )}

      {error && (
        <div className="flex-shrink-0 p-3 bg-destructive/10 text-destructive text-sm flex items-center justify-between border-b border-destructive/20 z-50" role="alert">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button onClick={clearError} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive">Dismiss</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* SIDEBAR */}
        <div className={cn(
          "workspace-library flex-shrink-0 border-r border-border bg-sidebar flex-col z-10 relative",
          isHome ? "md:w-[224px]" : libraryVisible ? "w-full md:w-[264px]" : "w-full md:!hidden",
          isHome || isMobileEditorOpen ? "hidden md:flex" : "flex"
        )}>
        <div className="p-4 pb-4 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight text-sidebar-foreground flex items-center gap-2">
              <BrandMark className="w-6 h-5" />
              Quickque
            </h1>

          </div>
          {!isHome && <div className="flex flex-col gap-1.5">
            <button
              onClick={handleCreate}
              className="flex items-center justify-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            >
              <Plus className="h-4 w-4" />
              New script
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Import Document"
            >
              <FileUp className="h-4 w-4" />
              Import document
            </button>
          </div>

          }
          <nav aria-label="Script library" className="flex flex-col gap-1">
            <button
              className={cn(
                "flex items-center justify-center gap-2 text-sm px-2 py-2 rounded-md transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                viewMode === 'library' ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={viewMode === 'library' ? 'page' : undefined}
              onClick={() => { setViewMode('library'); setSearch(''); setLocation('/'); }}
            >
              <Home className="h-4 w-4" />
              Workspace
              <span className="text-xs opacity-60">{scripts.length}</span>
            </button>
            <button
              className={cn(
                "flex items-center justify-center gap-2 text-sm px-2 py-2 rounded-md transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                viewMode === 'trash' ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={viewMode === 'trash' ? 'page' : undefined}
              onClick={() => { setViewMode('trash'); setSearch(''); setLocation('/trash'); }}
            >
              <Trash2 className="h-4 w-4" />
              Trash
              <span className="text-xs opacity-60">{trash.length}</span>
            </button>
          </nav>

          <div className={isHome ? "hidden" : "space-y-3"}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={viewMode === 'trash' ? 'Search Trash…' : 'Search scripts…'}
                aria-label="Search scripts"
                className="w-full pl-9 pr-8 py-2.5 bg-background border border-sidebar-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              />
              {search && (
                <button 
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {search ? `${visibleItems.length} results` : viewMode === 'trash' ? 'Deleted scripts' : 'Your scripts'}
              </span>
              {viewMode === 'library' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-2 py-1.5 hover:bg-sidebar-accent rounded-md text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Sort scripts: ${SORT_LABELS[sortMode]}`}>
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{SORT_LABELS[sortMode]}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                    <DropdownMenuRadioItem value="newest">{SORT_LABELS['newest']}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="oldest">{SORT_LABELS['oldest']}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="az">{SORT_LABELS['az']}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="za">{SORT_LABELS['za']}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="custom">{SORT_LABELS['custom']}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {!isHome && sortMode === 'custom' && viewMode === 'library' && (
          <div className="px-5 pb-3 text-[11px] leading-relaxed text-muted-foreground">
            {search ? (
              "Clear search to reorder scripts."
            ) : (
              "Drag scripts to reorder, or use their options menu."
            )}
          </div>
        )}

        {!isHome && viewMode === 'trash' && <p className="px-5 pb-3 text-[11px] text-muted-foreground">Kept on this device until you permanently delete them.</p>}
        <div className={isHome ? "hidden" : "flex-1 overflow-y-auto p-2 space-y-1"}>
          {visibleItems.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm mt-4">
              {search ? 'No scripts found' : viewMode === 'trash' ? (
                <>Trash is empty<br/><span className="text-xs opacity-70">No automatic expiry</span></>
              ) : 'No scripts yet'}
            </div>
          ) : (
            visibleItems.map((script, idx) => {
              const isPerformance = getScriptPurpose(script) === 'performance';
              const setupIssues = isPerformance ? getSceneSetupIssues(script) : [];
              const totalWords = script.sections.reduce((acc, sec) => acc + calculateWordCount(sec.content), 0);
              const timeSec = estimateTime(totalWords);
              const isActive = script.id === activeScriptId;
              const itemInTrash = viewMode === 'trash' ? trash.find(t => t.script.id === script.id) : null;
              const isDraggable = sortMode === 'custom' && !search && viewMode === 'library';
              
              return (
                <div 
                  key={script.id}
                  draggable={isDraggable}
                  onDragStart={(e) => handleDragStart(e, script.id)}
                  onDragOver={(e) => handleDragOver(e, script.id)}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => handleDrop(e, script.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "group flex items-center justify-between px-3 py-3 rounded-md transition-colors",
                    isActive ? "bg-sidebar-accent text-sidebar-foreground" : "hover:bg-sidebar-accent text-sidebar-foreground",
                    dragOverId === script.id && "border-t-2 border-primary",
                    draggedId === script.id && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
                    <div className="flex-1 min-w-0 flex flex-col items-start">
                      {editingId === script.id ? (
                        <input 
                          autoFocus
                          maxLength={200}
                          className="w-full bg-background text-foreground text-sm px-1 py-0.5 rounded border border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary"
                          defaultValue={script.title}
                          onBlur={e => {
                            const val = e.target.value.trim();
                            if (val && val !== script.title) {
                              updateScript(script.id, { title: val });
                            }
                            setEditingId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          aria-label="Rename script"
                        />
                      ) : (
                        <button
                          className="text-left font-medium truncate text-sm w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                          onClick={() => {
                            if (viewMode === 'library') handleOpenScript(script.id);
                          }}
                        >
                          {script.title || 'Untitled Script'}
                        </button>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {viewMode === 'trash' ? `Deleted ${itemInTrash ? new Date(itemInTrash.deletedAt).toLocaleDateString() : ''}` : `${isPerformance ? 'Performance' : 'Presentation'} · ${isPerformance ? `${script.sections.length} turns` : formatTime(timeSec)}`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="relative flex-shrink-0">
                    {scriptMenu(script, idx)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-sidebar-border mt-auto">
          <SettingsDialog />
        </div>
      </div>

      {/* EDITOR */}
      <div className={cn(
        "flex-1 flex-col min-w-0 bg-background relative overflow-hidden",
        "flex"
      )}>
        <Dialog open={showCreate} onOpenChange={open => { if (!creatingSample) setShowCreate(open); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>What are you preparing?</DialogTitle>
            <DialogDescription>Choose your script type. You can change it in the editor anytime.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button disabled={creatingSample} onClick={() => createWithPurpose('presentation')} className="rounded-xl border border-border p-5 text-left hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <MonitorPlay className="mb-3 h-6 w-6 text-primary" />
              <span className="block font-semibold">Presentation</span>
              <span className="mt-2 block text-sm text-muted-foreground">Talks, meetings and videos. Organize your script into sections.</span>
            </button>
            <button disabled={creatingSample} onClick={() => createWithPurpose('performance')} className="rounded-xl border border-border p-5 text-left hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <FileText className="mb-3 h-6 w-6 text-primary" />
              <span className="block font-semibold">Performance / Self-tape</span>
              <span className="mt-2 block text-sm text-muted-foreground">Cast your scene, choose your role and rehearse with a local scene partner.</span>
            </button>
          </div>
          <button disabled={creatingSample} onClick={createSample} className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-left hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
            <span className="block font-semibold">{creatingSample ? 'Preparing sample…' : 'Try Matilda sample'}</span>
            <span className="mt-1 block text-sm text-muted-foreground">Play Matilda in person. Miss Honey, Nigel and Lavender are AI Partners, with colours and stage notes set up.</span>
            <span className="mt-2 block text-xs text-muted-foreground">14 dialogue turns · Uses installed English voices when available. You can change roles and voices in Scene Partner.</span>
          </button>
        </DialogContent>
      </Dialog>
      <DocumentImportDialog
          open={isImportOpen} 
          onOpenChange={setIsImportOpen} 
          onSuccess={() => {
            setViewMode('library');
            setSearch('');
            setIsMobileEditorOpen(true);
          }}
          externalFile={droppedFile}
          externalError={droppedError}
          clearExternal={() => {
            setDroppedFile(null);
            setDroppedError(null);
          }}
        />

        {!isHome && showBanner && (
          <div className="flex-shrink-0 p-4 bg-primary/10 border-b border-primary/20 z-40 flex items-center justify-between animate-in slide-in-from-top-2">
            <div>
              <h3 className="font-semibold text-primary">Welcome to Quickque!</h3>
              <p className="text-sm text-primary/80 mt-0.5">Try the welcome walkthrough, then create your first script.</p>
            </div>
            <button
              onClick={handleCreate}
              className="flex-shrink-0 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-sm whitespace-nowrap ml-4 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Script
            </button>
          </div>
        )}

        {isHome ? <main className="workspace-home flex-1 overflow-y-auto bg-card px-5 py-6 md:px-10 md:py-9">
          <div className="mx-auto max-w-6xl space-y-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="mb-1 text-xs text-muted-foreground">Quickque workspace</p><h1 className="text-2xl font-semibold tracking-tight">{viewMode === 'trash' ? 'Trash' : 'Your scripts'}</h1><p className="mt-2 text-sm text-muted-foreground">{viewMode === 'trash' ? 'Restore scripts or permanently remove them.' : 'Pick a script to edit, present or rehearse.'}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setIsImportOpen(true)} aria-label="Import Document" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Import document</button>
                <button type="button" onClick={handleCreate} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" />New script</button>
              </div>
            </header>
            <div className="flex flex-wrap gap-3 md:hidden">
              <button type="button" onClick={() => setLocation('/')} className="text-sm text-primary">Workspace</button>
              <button type="button" onClick={() => setLocation('/trash')} className="text-sm text-muted-foreground">Trash ({trash.length})</button>
              <SettingsDialog />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="Search scripts" placeholder="Search scripts…" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-md border border-border bg-transparent py-2 pl-9 pr-3 text-sm focus-visible:outline-primary" /></label>
              {viewMode === 'library' && <select aria-label="Sort scripts" value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)} className="rounded-md border border-border bg-card px-3 py-2 text-sm">{Object.entries(SORT_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>}
              <span className="text-xs text-muted-foreground">{visibleItems.length} {visibleItems.length === 1 ? 'script' : 'scripts'}</span>
            </div>
            {visibleItems.length === 0 ? <div className="rounded-lg border border-dashed border-border py-16 text-center"><FileText className="mx-auto mb-4 h-8 w-8 text-muted-foreground" /><p className="font-medium">{search ? 'No scripts found' : viewMode === 'trash' ? 'Trash is empty' : 'A fresh workspace'}</p><p className="mt-2 text-sm text-muted-foreground">{search ? 'Try a different search.' : viewMode === 'trash' ? 'Deleted scripts will appear here.' : 'Create a script or import a document to begin.'}</p></div> :
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleItems.map((script, idx) => {
                const performance = getScriptPurpose(script) === 'performance';
                const words = script.sections.reduce((sum, section) => sum + calculateWordCount(section.content), 0);
                const preview = script.sections.map(section => section.content).filter(Boolean).slice(0, 3).join(' ');
                return <article key={script.id} aria-label={script.title || 'Untitled Script'} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
                  <div className="h-36 overflow-hidden border-b border-border bg-muted/45 p-5"><p className="line-clamp-4 text-sm leading-7 text-muted-foreground">{preview.slice(0, 700) || 'Your next script starts here.'}</p></div>
                  <div className="flex-1 space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      {editingId === script.id ? <input autoFocus aria-label="Rename script" maxLength={200} defaultValue={script.title} className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1" onBlur={event => { const title = event.target.value.trim(); if (title) updateScript(script.id, { title }); setEditingId(null); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditingId(null); }} /> : <h2 className="min-w-0 pt-1 font-semibold"><button type="button" className="line-clamp-2 text-left hover:text-primary focus-visible:outline-primary" onClick={() => viewMode === 'library' && handleOpenScript(script.id)}>{script.title || 'Untitled Script'}</button></h2>}
                      {scriptMenu(script, idx)}
                    </div>
                    <p className="text-xs text-muted-foreground">{performance ? 'Performance' : 'Presentation'} · {words} words · {formatTime(estimateTime(words))}</p>
                    <p className="text-xs text-muted-foreground">Updated {new Date(script.updatedAt).toLocaleDateString()}</p>
                  </div>
                  {viewMode === 'library' && <div className="grid grid-cols-2 gap-2 px-4 pb-4">
                    <button type="button" aria-label={`Edit ${script.title || 'Untitled Script'}`} onClick={() => handleOpenScript(script.id)} className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><Edit2 className="h-3.5 w-3.5" />Edit</button>
                    <button type="button" disabled={checkingScript !== null} aria-label={`${performance ? 'Rehearse' : 'Present'} ${script.title || 'Untitled Script'}`} onClick={() => void playFromHome(script)} className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Play className="h-3.5 w-3.5" />{checkingScript === script.id ? 'Checking…' : performance ? 'Rehearse' : 'Present'}</button>
                  </div>}
                </article>;
              })}
            </div>}
          </div>
        </main> : activeScript ? (
          <Editor 
            script={activeScript} 
            settings={settings}
            onChange={(updates) => updateScript(activeScript.id, updates)} 
            onPresent={handlePresent}
            onCloseMobile={() => setIsMobileEditorOpen(false)}
            libraryVisible={libraryVisible}
            onToggleLibrary={() => setLibraryVisible(value => !value)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <FileText className="w-16 h-16 mb-4 opacity-20" />
            <h2 className="text-xl font-medium mb-2 text-foreground">No script selected</h2>
            <p className="text-sm">Select a script from the sidebar or create a new one.</p>
            {viewMode === 'library' && (
              <button 
                onClick={handleCreate}
                className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-md shadow hover:bg-primary/90 transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Plus className="w-4 h-4" />
                Create Script
              </button>
            )}
          </div>
        )}
      </div>
      
      </div> {/* End layout flex */}

      <Dialog open={homeIssues !== null} onOpenChange={open => { if (!open) setHomeIssues(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Finish setting up your performance</DialogTitle><DialogDescription>These items need attention before partner playback.</DialogDescription></DialogHeader>
          <ul className="space-y-2 text-sm">{homeIssues?.messages.map((message, index) => <li key={index}>{message}</li>)}</ul>
          <button type="button" onClick={() => { if (homeIssues) handleOpenScript(homeIssues.script.id); setHomeIssues(null); }} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Edit script setup</button>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'trash' && `Move ${confirmAction.ids.length} script${confirmAction.ids.length === 1 ? '' : 's'} to Trash?`}
              {confirmAction?.type === 'permanent' && `Permanently delete ${confirmAction.ids.length} script${confirmAction.ids.length === 1 ? '' : 's'}?`}
              {confirmAction?.type === 'restore' && `Restore ${confirmAction.ids.length} script${confirmAction.ids.length === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'trash' && "You can restore them later from the Trash."}
              {confirmAction?.type === 'permanent' && "This action cannot be undone. The selected scripts will be deleted forever."}
              {confirmAction?.type === 'restore' && "Scripts will be returned to your library."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction?.type !== 'restore' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmAction) return;
                let success = false;
                if (confirmAction.type === 'trash') {
                  success = deleteScripts(confirmAction.ids);
                  if (success && activeScriptId && confirmAction.ids.includes(activeScriptId)) {
                    setIsMobileEditorOpen(false);
                  }
                } else if (confirmAction.type === 'restore') {
                  success = restoreScripts(confirmAction.ids);
                  if (success) {
                    setViewMode('library');
                    setSearch('');
                    setIsMobileEditorOpen(true);
                  }
                } else if (confirmAction.type === 'permanent') {
                  success = permanentlyDeleteScripts(confirmAction.ids);
                }
                
                if (success) {
                  setConfirmAction(null);
                }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
type ScriptMenuProps = {
  viewMode: 'library' | 'trash';
  isActive: boolean;
  scriptTitle: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
  onExportJSON: () => void;
  onExportTXT: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function ScriptMenu({ 
  viewMode, isActive, scriptTitle, onRename, onDuplicate, onDelete, 
  onRestore, onPermanentDelete, onExportJSON, onExportTXT,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown
}: ScriptMenuProps) {
  const renameAfterClose = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button 
          className={cn(
             "p-2.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isActive 
              ? "hover:bg-black/10 dark:hover:bg-white/20" 
               : "hover:bg-black/5 dark:hover:bg-white/10"
          )}
          aria-label={`Options for ${scriptTitle}`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={event => {
        if (renameAfterClose.current) {
          event.preventDefault();
          renameAfterClose.current = false;
          onRename();
        }
      }}>
        {viewMode === 'library' ? (
          <>
            <DropdownMenuItem onSelect={() => { renameAfterClose.current = true; }}>
              <Edit2 className="w-4 h-4 mr-2" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="w-4 h-4 mr-2" /> Duplicate
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem onClick={onExportTXT}>
              <FileText className="w-4 h-4 mr-2" /> Export as TXT
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportJSON}>
              <Code className="w-4 h-4 mr-2" /> Export as JSON
            </DropdownMenuItem>

            {(canMoveUp || canMoveDown) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
                  <ArrowUp className="w-4 h-4 mr-2" /> Move Up
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
                  <ArrowDown className="w-4 h-4 mr-2" /> Move Down
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
              <Trash2 className="w-4 h-4 mr-2" /> Move to Trash
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="w-4 h-4 mr-2" /> Restore
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onPermanentDelete} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
              <Trash className="w-4 h-4 mr-2" /> Delete Permanently
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
