export type ScriptSection = {
  id: string;
  title: string;
  content: string;
};

export type Script = {
  id: string;
  title: string;
  sections: ScriptSection[];
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  fontSize: number; // in px, e.g. 32
  speed: number; // arbitrary scale 1-100, where 50 is avg
  backgroundOpacity: number; // 0 to 100
  darkTheme: boolean;
  compactMode: boolean; // Overlay mode
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 48,
  speed: 50,
  backgroundOpacity: 85,
  darkTheme: true, // Default to dark for prompter
  compactMode: false,
};
