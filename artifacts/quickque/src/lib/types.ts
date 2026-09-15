export type ScriptSection = {
  id: string;
  title: string;
  content: string;
  /** Optional director's notes/cues; never part of spoken dialogue. */
  notes?: string;
  /** Missing means legacy/undifferentiated notes; never infer writer authorship. */
  notesProvenance?: 'writer' | 'legacy';
  /** Script-scoped cast identity. A missing identity is visibly unassigned. */
  characterId?: string | null;
};

export type ActorVoice = {
  /**
   * `system` is retained only so old libraries can be read and migrated. New
   * authoring never creates this value; missing system voices are explicit
   * rather than silently replaced with a different voice.
   */
  engine: 'system' | 'turbo';
  voiceId: string;
  rate: number;
  /** Revision of the local cloned reference used by Turbo. */
  voiceRevision?: number;
};

export type ActorCharacter = {
  id: string;
  name: string;
  /** Optional six-digit hex accent; older casts receive a stable default. */
  accentColor?: string;
  age: string;
  gender: string;
  style: string;
  voice: ActorVoice;
};

/** An explicit, user-confirmed responsibility for a character in a rehearsal. */
export type CharacterRoleAssignment = 'my-role' | 'another-person' | 'computer-partner';
export type ActorMode = {
  enabled: boolean;
  characters: ActorCharacter[];
  myRoleIds: string[];
  /**
   * New setup flow assignments. `myRoleIds` remains for portable compatibility
   * with older libraries; an absent map is never treated as a confirmation by
   * readiness checks.
   */
  roleAssignments?: Record<string, CharacterRoleAssignment>;
};

/** Descriptive aliases used by integrations that call this an actor config. */
export type ActorConfig = ActorMode;
export type ScriptActor = ActorMode;

export type ScriptPurpose = 'presentation' | 'performance';

export type ScriptImportSource = {
  fileName: string;
  format: 'txt' | 'md' | 'docx' | 'rtf' | 'pdf' | 'paste';
  /** Original local extraction, retained as a read-only reference. */
  originalText: string;
  warnings: string[];
};

/** A rehearsal annotation owned by this device/user, not by the script author. */
export type PersonalNote = {
  id: string;
  sectionId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type PracticeMode = 'read-through' | 'prompted' | 'off-book';

/** Local rehearsal choices only. Source dialogue and writer directions never live here. */
export type PracticePreferences = {
  mode: PracticeMode;
  startTurn: number;
  endTurn: number;
  difficultSectionIds: string[];
};

/** The source-authored baseline retained for an imported performance. */
export type OriginalScriptBaseline = {
  title: string;
  purpose: ScriptPurpose;
  sections: ScriptSection[];
};

export type ScriptProtection = {
  state: 'protected' | 'unlocked';
  original: OriginalScriptBaseline;
};

export type Script = {
  /** Script identity is independent of whether partner audio is enabled. */
  purpose?: ScriptPurpose;
  id: string;
  title: string;
  sections: ScriptSection[];
  createdAt: number;
  updatedAt: number;
  /**
   * Presentation styling is stored with each script. Optional keeps older
   * exports and native libraries source-compatible while they are migrated.
   */
  presentation?: PresentationPreferences;
  /** Optional actor/self-tape scene-partner configuration. */
  actor?: ActorMode;
  /**
   * Optional local narrator assignment. This contains only stable metadata;
   * recording bytes and conditioning data live in app-private desktop storage.
   */
  narratorVoice?: ActorVoice | null;
  importSource?: ScriptImportSource;
  /**
   * New imported performances explicitly retain their source baseline. Missing
   * protection on older files means legacy data remains editable.
   */
  protection?: ScriptProtection;
  /** Personal annotations are separate from writer directions (`sections.notes`). */
  personalNotes?: PersonalNote[];
  /** Device-local learning choices; safe to discard when turn IDs no longer exist. */
  practice?: PracticePreferences;
};

export type Settings = {
  fontSize: number; // in px, e.g. 32
  speed: number; // arbitrary scale 1-100, where 50 is avg
  backgroundOpacity: number; // 0 to 100
  darkTheme: boolean;
  compactMode: boolean; // Overlay mode
  /** null follows the active theme's foreground colour. */
  textColor: string | null;
  /** A curated, locally available font stack for script copy. */
  fontFamily: FontFamily;
};

export type FontFamily = 'system' | 'arial' | 'georgia' | 'monospace';

export type CueStyle = 'hidden' | 'line' | 'arrows';

export type PresentationPreferences = {
  fontSize: number;
  speed: number;
  /** Seconds to wait before a fresh presentation starts. */
  countdownSeconds: number;
  /** Active manual-scrolling duration target, or null to use the normal speed. */
  targetDurationSeconds: number | null;
  /** Whether elapsed/remaining/progress timing is shown while presenting. */
  showTiming: boolean;
  /** Whether presentation controls fade while playback is active. */
  hideControlsWhilePlaying: boolean;
  /** Whether a user scroll gesture pauses manual playback. */
  pauseOnManualScroll: boolean;
  backgroundOpacity: number;
  fontFamily: FontFamily;
  textColor: string | null;
  backgroundColor: string;
  lineSpacing: number;
  horizontalMargin: number;
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
  cueStyle: CueStyle;
  cuePosition: number;
  cueColor: string;
  cueOpacity: number;
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 48,
  speed: 50,
  backgroundOpacity: 85,
  darkTheme: true, // Default to dark for prompter
  compactMode: false,
  textColor: null,
  fontFamily: 'system',
};

export type SortMode = 'newest' | 'oldest' | 'az' | 'za' | 'custom';

export type DeletedScript = {
  script: Script;
  deletedAt: number;
};
