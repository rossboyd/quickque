import React, { useState, useEffect, useId } from 'react';
import { AppearanceControls } from '@/components/appearance-controls';
import { getFontFamilyCss, normalizeTextColor, getThemeDefaultPickerColor, isValidTextColor } from '@/lib/appearance';
import type { PresentationPreferences, Settings } from '@/lib/types';

function getLuminance(hex: string) {
  if (!hex || hex.length !== 7 || !/^#[0-9A-Fa-f]{6}$/i.test(hex)) return 1;
  const rgb = parseInt(hex.slice(1), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >>  8) & 0xff;
  const b = (rgb >>  0) & 0xff;
  const [rS, gS, bS] = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return rS * 0.2126 + gS * 0.7152 + bS * 0.0722;
}

function getContrast(hex1: string, hex2: string) {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function PresentationControls({
  value,
  onChange,
  globalDarkTheme = true,
  readMode = undefined,
}: {
  value: PresentationPreferences;
  onChange: (updates: Partial<PresentationPreferences>) => boolean;
  globalDarkTheme?: boolean;
  /**
   * Global defaults do not have an active reader mode. When a reader supplies
   * its mode, timed scrolling is only available in Manual Scroll.
   */
  readMode?: 'manual' | 'flow';
}) {
  const controlId = useId();
  
  const [bgDraft, setBgDraft] = useState(value.backgroundColor);
  const [bgError, setBgError] = useState<string | null>(null);

  const [cueColorDraft, setCueColorDraft] = useState(value.cueColor);
  const [cueColorError, setCueColorError] = useState<string | null>(null);

  useEffect(() => {
    setBgDraft(value.backgroundColor);
    setBgError(null);
  }, [value.backgroundColor]);

  useEffect(() => {
    setCueColorDraft(value.cueColor);
    setCueColorError(null);
  }, [value.cueColor]);

  const applyBgDraft = () => {
    const hex = bgDraft.trim();
    if (!isValidTextColor(hex)) {
      setBgError('Enter a valid six-digit hex color (e.g. #000000)');
      return;
    }
    const success = onChange({ backgroundColor: hex.toUpperCase() });
    if (success) {
      setBgError(null);
      setBgDraft(hex.toUpperCase());
    } else {
      setBgDraft(value.backgroundColor);
      setBgError('Could not save color');
    }
  };

  const applyCueColorDraft = () => {
    const hex = cueColorDraft.trim();
    if (!isValidTextColor(hex)) {
      setCueColorError('Enter a valid six-digit hex color (e.g. #FF0000)');
      return;
    }
    const success = onChange({ cueColor: hex.toUpperCase() });
    if (success) {
      setCueColorError(null);
      setCueColorDraft(hex.toUpperCase());
    } else {
      setCueColorDraft(value.cueColor);
      setCueColorError('Could not save color');
    }
  };
  const appearanceSettings: Settings = {
    fontSize: value.fontSize,
    speed: value.speed,
    fontFamily: value.fontFamily,
    textColor: value.textColor,
    darkTheme: globalDarkTheme,
    compactMode: false,
    backgroundOpacity: 100,
  };

  const updateAppearance = (updates: Partial<Settings>) => {
    const partial: Partial<PresentationPreferences> = {};
    if (updates.fontFamily !== undefined) partial.fontFamily = updates.fontFamily;
    if (updates.textColor !== undefined) partial.textColor = updates.textColor;
    if (Object.keys(partial).length > 0) {
      onChange(partial);
    }
  };

  const update = <K extends keyof PresentationPreferences>(field: K, val: PresentationPreferences[K]) => {
    return onChange({ [field]: val });
  };

  const resolvedTextColor = normalizeTextColor(value.textColor) ?? getThemeDefaultPickerColor(globalDarkTheme);
  
  const contrast = value.backgroundColor.startsWith('#') 
    ? getContrast(resolvedTextColor, value.backgroundColor) 
    : null;
  
  const lowContrast = contrast !== null && contrast < 4.5;
  const isTransparent = value.backgroundOpacity < 100;


  return (
    <div className="space-y-8 pb-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Controls Panel */}
        <div className="space-y-8">
          
          <section className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
              Typography
            </h4>
            <div className="[&_[aria-label='Script_appearance_preview']]:hidden">
              <AppearanceControls settings={appearanceSettings} updateSettings={updateAppearance} />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center">
                <label htmlFor={`${controlId}-font-size`} className="font-medium text-sm">Font Size</label>
                <span className="text-xs text-muted-foreground font-mono">{value.fontSize}px</span>
              </div>
              <input id={`${controlId}-font-size`} type="range" min="16" max="120" value={value.fontSize} onChange={e => update('fontSize', Number(e.target.value))} className="w-full accent-primary" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor={`${controlId}-line-spacing`} className="font-medium text-sm">Line Spacing</label>
                <span className="text-xs text-muted-foreground font-mono">{value.lineSpacing.toFixed(1)}x</span>
              </div>
              <input id={`${controlId}-line-spacing`} type="range" min="1" max="3" step="0.1" value={value.lineSpacing} onChange={e => update('lineSpacing', Number(e.target.value))} className="w-full accent-primary" />
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
              Layout & Canvas
            </h4>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor={`${controlId}-speed`} className="font-medium text-sm">Scroll Speed</label>
                <span className="text-xs text-muted-foreground font-mono">{value.speed}</span>
              </div>
              <input id={`${controlId}-speed`} type="range" min="10" max="150" value={value.speed} onChange={e => update('speed', Number(e.target.value))} className="w-full accent-primary" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor={`${controlId}-horizontal-margin`} className="font-medium text-sm">Horizontal Margin</label>
                <span className="text-xs text-muted-foreground font-mono">{value.horizontalMargin}%</span>
              </div>
              <input id={`${controlId}-horizontal-margin`} type="range" min="0" max="30" value={value.horizontalMargin} onChange={e => update('horizontalMargin', Number(e.target.value))} className="w-full accent-primary" />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <label htmlFor={`${controlId}-bg-color`} className="font-medium text-sm block">Background Color</label>
                <div className="flex items-center gap-2">
                  <label htmlFor={`${controlId}-bg-picker`} className="sr-only">Choose background color</label>
                  <input 
                    id={`${controlId}-bg-picker`} 
                    type="color" 
                    value={value.backgroundColor} 
                    onChange={e => {
                      const hex = e.target.value.toUpperCase();
                      const success = update('backgroundColor', hex);
                      if (success) {
                        setBgDraft(hex);
                        setBgError(null);
                      } else {
                        setBgDraft(value.backgroundColor);
                        setBgError('Could not save color');
                      }
                    }} 
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-1 focus:outline-none focus:ring-2 focus:ring-ring shrink-0" 
                  />
                  <input 
                    id={`${controlId}-bg-color`} 
                    type="text" 
                    value={bgDraft} 
                    onChange={e => {
                      setBgDraft(e.target.value);
                      if (bgError) setBgError(null);
                    }}
                    onBlur={applyBgDraft}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyBgDraft();
                      }
                    }}
                    aria-invalid={bgError ? 'true' : 'false'}
                    aria-describedby={bgError ? `${controlId}-bg-error` : undefined}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring" 
                    maxLength={7} 
                  />
                </div>
                {bgError && (
                  <p id={`${controlId}-bg-error`} role="alert" className="text-xs text-destructive mt-1">
                    {bgError}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor={`${controlId}-bg-opacity`} className="font-medium text-sm">Opacity</label>
                  <span className="text-xs text-muted-foreground font-mono">{value.backgroundOpacity}%</span>
                </div>
                <input id={`${controlId}-bg-opacity`} type="range" min="0" max="100" value={value.backgroundOpacity} onChange={e => update('backgroundOpacity', Number(e.target.value))} className="w-full h-9 accent-primary" />
              </div>
            </div>

            <div className="flex gap-6 pt-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input type="checkbox" checked={value.mirrorHorizontal} onChange={e => update('mirrorHorizontal', e.target.checked)} className="rounded border-border text-primary focus:ring-2 focus:ring-primary h-4 w-4" />
                Mirror Horizontal
              </label>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input type="checkbox" checked={value.mirrorVertical} onChange={e => update('mirrorVertical', e.target.checked)} className="rounded border-border text-primary focus:ring-2 focus:ring-primary h-4 w-4" />
                Mirror Vertical
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
              Timing & Playback
            </h4>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={`${controlId}-countdown`} className="font-medium text-sm">
                  Start Countdown (seconds)
                </label>
                <input
                  id={`${controlId}-countdown`}
                  type="number"
                  min="0"
                  max="30"
                  step="1"
                  value={value.countdownSeconds}
                  onChange={e => update('countdownSeconds', Number(e.target.value))}
                  className="w-24 rounded-md border border-border bg-background px-2.5 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Wait up to 30 seconds before a fresh start. Set to 0 to start
                immediately; pausing and resuming does not restart the countdown.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={`${controlId}-target-duration`} className="font-medium text-sm">
                  Target Duration (seconds)
                </label>
                <input
                  id={`${controlId}-target-duration`}
                  type="number"
                  min="1"
                  max="86400"
                  step="1"
                  value={value.targetDurationSeconds ?? ''}
                  disabled={readMode === 'flow'}
                  onChange={e => {
                    const raw = e.target.value;
                    update(
                      'targetDurationSeconds',
                      raw === '' ? null : Number(raw),
                    );
                  }}
                  aria-describedby={`${controlId}-target-duration-help`}
                  className="w-28 rounded-md border border-border bg-background px-2.5 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <p id={`${controlId}-target-duration-help`} className="text-xs text-muted-foreground">
                {readMode === 'flow'
                  ? 'Timed scrolling is available only in Manual Scroll. Voice Follow controls the reading position instead.'
                  : 'Total active time for this session (1–86,400 seconds). Manual Scroll derives speed from the remaining rendered text and time left. Pauses extend wall-clock completion time; this is not a guarantee of spoken duration. If the target has elapsed, choose a longer duration or Start over. Leave blank to use the regular scroll speed.'}
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <label className="flex items-start gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.showTiming}
                  onChange={e => update('showTiming', e.target.checked)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-2 focus:ring-primary h-4 w-4"
                />
                <span>
                  <span className="block">Show Timing</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Show elapsed time, estimated remaining time, and progress while presenting.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.hideControlsWhilePlaying}
                  onChange={e => update('hideControlsWhilePlaying', e.target.checked)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-2 focus:ring-primary h-4 w-4"
                />
                <span>
                  <span className="block">Hide Controls While Playing</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Keep the reading surface clear while playback is active; controls remain revealable.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.pauseOnManualScroll}
                  onChange={e => update('pauseOnManualScroll', e.target.checked)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-2 focus:ring-primary h-4 w-4"
                />
                <span>
                  <span className="block">Pause on Manual Scroll</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Pause playback when you use a real scroll gesture to find your place.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
              Reading Cue
            </h4>
            
            <div className="flex flex-col gap-2">
              <label htmlFor={`${controlId}-cue-style`} className="font-medium text-sm">Cue Indicator Style</label>
              <select id={`${controlId}-cue-style`} value={value.cueStyle} onChange={e => update('cueStyle', e.target.value as any)} className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-48">
                <option value="hidden">Hidden</option>
                <option value="line">Horizontal Line</option>
                <option value="arrows">Side Arrows</option>
              </select>
            </div>

            {value.cueStyle !== 'hidden' && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label htmlFor={`${controlId}-cue-position`} className="font-medium text-sm">Vertical Position</label>
                    <span className="text-xs text-muted-foreground font-mono">{value.cuePosition}%</span>
                  </div>
                  <input id={`${controlId}-cue-position`} type="range" min="10" max="80" value={value.cuePosition} onChange={e => update('cuePosition', Number(e.target.value))} className="w-full accent-primary" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor={`${controlId}-cue-color`} className="font-medium text-sm block">Cue Color</label>
                    <div className="flex items-center gap-2">
                      <label htmlFor={`${controlId}-cue-picker`} className="sr-only">Choose cue color</label>
                      <input 
                        id={`${controlId}-cue-picker`} 
                        type="color" 
                        value={value.cueColor} 
                        onChange={e => {
                          const hex = e.target.value.toUpperCase();
                          const success = update('cueColor', hex);
                          if (success) {
                            setCueColorDraft(hex);
                            setCueColorError(null);
                          } else {
                            setCueColorDraft(value.cueColor);
                            setCueColorError('Could not save color');
                          }
                        }} 
                        className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-1 focus:outline-none focus:ring-2 focus:ring-ring shrink-0" 
                      />
                      <input 
                        id={`${controlId}-cue-color`} 
                        type="text" 
                        value={cueColorDraft} 
                        onChange={e => {
                          setCueColorDraft(e.target.value);
                          if (cueColorError) setCueColorError(null);
                        }}
                        onBlur={applyCueColorDraft}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            applyCueColorDraft();
                          }
                        }}
                        aria-invalid={cueColorError ? 'true' : 'false'}
                        aria-describedby={cueColorError ? `${controlId}-cue-error` : undefined}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring" 
                        maxLength={7} 
                      />
                    </div>
                    {cueColorError && (
                      <p id={`${controlId}-cue-error`} role="alert" className="text-xs text-destructive mt-1">
                        {cueColorError}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label htmlFor={`${controlId}-cue-opacity`} className="font-medium text-sm">Opacity</label>
                      <span className="text-xs text-muted-foreground font-mono">{value.cueOpacity}%</span>
                    </div>
                    <input id={`${controlId}-cue-opacity`} type="range" min="0" max="100" value={value.cueOpacity} onChange={e => update('cueOpacity', Number(e.target.value))} className="w-full h-9 accent-primary" />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Live Preview Panel */}
        <div className="lg:sticky lg:top-0 space-y-4 pt-8 lg:pt-0">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
            Live Preview
          </h4>
          <div 
            className="relative overflow-hidden rounded-xl border border-border shadow-sm flex items-center justify-center bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3hFxA+iaSABGzYBRM2DUTCAZMwGjZgJ1zQRiM4FQMwGjZgIA5k4IAf8A/3AAAAAASUVORK5CYII=')] bg-repeat transition-all"
            style={{ height: '400px' }}
            aria-label="Presentation Layout Preview"
            role="region"
          >
            {/* Background Layer */}
            <div 
              className="absolute inset-0 transition-colors duration-200"
              style={{
                backgroundColor: value.backgroundColor,
                opacity: value.backgroundOpacity / 100
              }}
            />
            
            {/* Mirroring Container */}
            <div 
              className="absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out"
              style={{
                transform: `scaleX(${value.mirrorHorizontal ? -1 : 1}) scaleY(${value.mirrorVertical ? -1 : 1})`,
              }}
            >
              {/* Content Layer */}
              <div 
                className="flex-1 relative font-medium transition-all"
                style={{
                  fontFamily: getFontFamilyCss(value.fontFamily),
                  color: resolvedTextColor,
                  fontSize: `${value.fontSize}px`,
                  lineHeight: value.lineSpacing,
                  paddingLeft: `${value.horizontalMargin}%`,
                  paddingRight: `${value.horizontalMargin}%`,
                }}
              >
                {/* Fake scroll positioning relative to cue position */}
                <div 
                  className="absolute left-0 right-0 w-full flex flex-col transition-all duration-300 pointer-events-none"
                  style={{
                    top: `${value.cuePosition}%`,
                    transform: 'translateY(-60%)',
                    paddingLeft: `${value.horizontalMargin}%`,
                    paddingRight: `${value.horizontalMargin}%`,
                  }}
                >
                  <p className="opacity-40 transition-opacity">This is how your</p>
                  <p className="opacity-40 transition-opacity">script copy will appear</p>
                  <p className="opacity-100 transition-opacity">when reading on camera.</p>
                  <p className="opacity-100 transition-opacity mt-[1em]">The text above is faded</p>
                  <p className="opacity-100 transition-opacity">so you focus on the cue.</p>
                </div>
              </div>

              {/* Cue Overlay Layer */}
              {value.cueStyle !== 'hidden' && (
                <div 
                  className="absolute left-0 right-0 pointer-events-none transition-all duration-300"
                  style={{
                    top: `${value.cuePosition}%`,
                    opacity: value.cueOpacity / 100,
                  }}
                >
                  {value.cueStyle === 'line' && (
                    <div 
                      className="h-[3px] w-full shadow-sm"
                      style={{ backgroundColor: value.cueColor }}
                    />
                  )}
                  {value.cueStyle === 'arrows' && (
                    <div className="flex justify-between px-3 -translate-y-1/2">
                      <div 
                        className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-l-[14px] drop-shadow-md"
                        style={{ borderLeftColor: value.cueColor }}
                      />
                      <div 
                        className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-r-[14px] drop-shadow-md"
                        style={{ borderRightColor: value.cueColor }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Contrast and Overlay Warnings */}
          <div className="space-y-2">
            {lowContrast && (
              <div role="alert" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 p-3 rounded-md border border-amber-500/20">
                <p className="font-semibold mb-1">Low Contrast Warning</p>
                Your text color and background color have a contrast ratio of {contrast?.toFixed(1)}:1. This may be difficult to read on camera. We recommend a ratio of at least 4.5:1.
              </div>
            )}
            {value.backgroundOpacity < 100 && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md border border-border">
                <p className="font-semibold mb-1 text-foreground">Transparent Background</p>
                At {value.backgroundOpacity}% opacity, your desktop or camera feed will show through the background. Make sure your text color contrasts well against your real-world environment.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
