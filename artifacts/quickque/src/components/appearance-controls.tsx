import { useEffect, useId, useState } from 'react';
import type { Settings } from '@/lib/types';
import {
  DEFAULT_SETTINGS,
} from '@/lib/types';
import {
  FONT_FAMILY_OPTIONS,
  getFontFamilyCss,
  getTextContrastRatio,
  getTextColorCss,
  getThemeDefaultPickerColor,
  isValidTextColor,
  normalizeTextColor,
} from '@/lib/appearance';

type AppearanceControlsProps = {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
};

export function AppearanceControls({
  settings,
  updateSettings,
}: AppearanceControlsProps) {
  const controlId = useId();
  const fontFamilyId = `${controlId}-font-family`;
  const colorPickerId = `${controlId}-text-color-picker`;
  const colorHexId = `${controlId}-text-color-hex`;
  const colorErrorId = `${controlId}-text-color-error`;
  const [colorDraft, setColorDraft] = useState(settings.textColor ?? '');
  const [colorError, setColorError] = useState<string | null>(null);

  useEffect(() => {
    setColorDraft(settings.textColor ?? '');
    setColorError(null);
  }, [settings.textColor]);

  const applyColorDraft = () => {
    const value = colorDraft.trim();
    if (value === '') {
      setColorError(null);
      updateSettings({ textColor: null });
      return;
    }
    if (!isValidTextColor(value)) {
      setColorError('Enter a six-digit hex colour such as #F5F7FA.');
      return;
    }
    const normalized = normalizeTextColor(value);
    setColorError(null);
    setColorDraft(normalized ?? '');
    updateSettings({ textColor: normalized });
  };

  const previewColor = normalizeTextColor(colorDraft) ?? settings.textColor;
  const contrastRatio = getTextContrastRatio(previewColor, settings.darkTheme);
  const hasLowContrast = contrastRatio !== null && contrastRatio < 4.5;
  const showContrastWarning = hasLowContrast ||
    (settings.compactMode && previewColor !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <label htmlFor={fontFamilyId} className="font-medium">
            Script font
          </label>
          <p className="text-sm text-muted-foreground">
            Offline-safe fonts for script copy
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <select
            id={fontFamilyId}
            value={settings.fontFamily}
            onChange={event => updateSettings({
              fontFamily: event.target.value as Settings['fontFamily'],
            })}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-[170px] sm:flex-none"
            aria-label="Script font"
          >
            {FONT_FAMILY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => updateSettings({ fontFamily: DEFAULT_SETTINGS.fontFamily })}
            disabled={settings.fontFamily === DEFAULT_SETTINGS.fontFamily}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Reset script font"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <label htmlFor={colorHexId} className="font-medium">
              Script text colour
            </label>
            <p className="text-sm text-muted-foreground">
              Leave blank to follow the active theme
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setColorDraft('');
              setColorError(null);
              updateSettings({ textColor: null });
            }}
            disabled={settings.textColor === null}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Reset script text colour"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={colorPickerId}
            className="sr-only"
          >
            Choose script text colour
          </label>
          <input
            id={colorPickerId}
            type="color"
            value={settings.textColor ?? getThemeDefaultPickerColor(settings.darkTheme)}
            onChange={event => {
              const normalized = normalizeTextColor(event.target.value);
              setColorDraft(normalized ?? '');
              setColorError(null);
              updateSettings({ textColor: normalized });
            }}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-1 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Choose script text colour"
          />
          <label htmlFor={colorHexId} className="sr-only">
            Script text colour hex value
          </label>
          <input
            id={colorHexId}
            type="text"
            inputMode="text"
            spellCheck={false}
            maxLength={7}
            value={colorDraft}
            onChange={event => {
              setColorDraft(event.target.value);
              if (colorError) setColorError(null);
            }}
            onBlur={applyColorDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyColorDraft();
              }
            }}
            placeholder="Theme default"
            aria-invalid={colorError ? 'true' : 'false'}
            aria-describedby={colorError ? colorErrorId : undefined}
            className="w-32 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {colorError && (
          <p id={colorErrorId} role="alert" className="text-xs text-destructive">
            {colorError}
          </p>
        )}
        {showContrastWarning && (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
            This colour may have low contrast against the current theme. Compact
            overlay transparency can change contrast further; you can keep this
            colour if it suits your setup.
          </p>
        )}
      </div>

      <div
        className="rounded-lg border border-border bg-background/60 p-3"
        aria-label="Script appearance preview"
        role="region"
      >
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Live preview
        </div>
        <p
          className="mt-1 text-lg font-medium"
          style={{
            color: getTextColorCss(previewColor),
            fontFamily: getFontFamilyCss(settings.fontFamily),
          }}
        >
          Your script copy will look like this.
        </p>
      </div>
    </div>
  );
}