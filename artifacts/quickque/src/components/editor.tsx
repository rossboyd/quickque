import { calculateWordCount, estimateTime, formatTime, generateId } from '@/lib/utils';
import { Play, Plus, Trash, ChevronUp, ChevronDown, ChevronLeft } from 'lucide-react';
import { Script, ScriptSection, Settings, DEFAULT_SETTINGS } from '@/lib/types';
import { MAX_SECTIONS } from '@/lib/store-persistence';
import { getFontFamilyCss, getTextColorCss } from '@/lib/appearance';

export function Editor({ 
  script, 
  onChange, 
  onPresent, 
  onCloseMobile,
  settings = DEFAULT_SETTINGS,
}: { 
  script: Script; 
  onChange: (u: Partial<Script>) => void; 
  onPresent: () => void; 
  onCloseMobile: () => void;
  settings?: Settings;
}) {
  const totalWords = script.sections.reduce((acc, sec) => acc + calculateWordCount(sec.content), 0);
  const timeSec = estimateTime(totalWords);

  const addSection = () => {
    onChange({
      sections: [...script.sections, { id: generateId(), title: 'New Section', content: '' }]
    });
  };

  const updateSection = (id: string, updates: Partial<ScriptSection>) => {
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-shrink-0 border-b border-border bg-background z-10 px-4 md:px-8 py-4 md:py-6">
        <div className="flex items-start justify-between gap-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button 
              onClick={onCloseMobile}
              className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              aria-label="Back to library"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <input 
                type="text"
                value={script.title}
                onChange={e => onChange({ title: e.target.value })}
                maxLength={200}
                className="w-full bg-transparent text-2xl md:text-3xl font-bold text-foreground focus:outline-none placeholder:text-muted-foreground/50 truncate"
                placeholder="Script Title"
                aria-label="Script Title"
              />
               <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground">
                <span>{totalWords} words</span>
                <span className="hidden sm:inline">Estimated time: {formatTime(timeSec)}</span>
                <span className="sm:hidden">~{formatTime(timeSec)}</span>
                <span>{script.sections.length} section{script.sections.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
          <button 
            onClick={onPresent}
            className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 bg-primary text-primary-foreground font-medium rounded-full shadow-lg shadow-black/10 dark:shadow-black/30 hover:bg-primary/90 hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            <Play className="w-4 h-4 md:w-5 md:h-5 fill-current" />
            Present
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6 pb-32">
          {script.sections.map((section, idx) => (
            <div key={section.id} className="group relative bg-card rounded-xl border border-card-border shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/40 transition-all">
              <div className="flex items-center justify-between p-3 border-b border-card-border bg-muted/30 rounded-t-xl min-w-0">
                <div className="flex items-center flex-1 gap-2 min-w-0">
                  <div className="flex flex-col text-muted-foreground flex-shrink-0">
                    <button 
                      onClick={() => moveSection(idx, -1)} 
                      disabled={idx === 0}
                      className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                      aria-label={`Move section "${section.title}" up`}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => moveSection(idx, 1)} 
                      disabled={idx === script.sections.length - 1}
                      className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                      aria-label={`Move section "${section.title}" down`}
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
                    placeholder="Section Title"
                    aria-label="Section Title"
                  />
                </div>
                <div className="flex items-center gap-2 transition-opacity flex-shrink-0">
                  <div className="text-xs text-muted-foreground font-mono bg-background px-2 py-1 rounded border hidden sm:block">
                    {calculateWordCount(section.content)} w
                  </div>
                  {script.sections.length > 1 && (
                    <button 
                      onClick={() => deleteSection(section.id)}
                      className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
                      title="Delete Section"
                      aria-label={`Delete section "${section.title}"`}
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={section.content}
                onChange={e => updateSection(section.id, { content: e.target.value })}
                maxLength={500000}
                className="w-full bg-transparent text-foreground p-4 min-h-[160px] resize-y focus:outline-none leading-relaxed"
                placeholder="Type your script here..."
                aria-label={`Section content for "${section.title}"`}
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
            title={script.sections.length >= MAX_SECTIONS ? 'Maximum 500 sections reached' : undefined}
            className="w-full py-4 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors flex items-center justify-center gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="w-5 h-5" />
            Add Section
          </button>
        </div>
      </div>
    </div>
  );
}
