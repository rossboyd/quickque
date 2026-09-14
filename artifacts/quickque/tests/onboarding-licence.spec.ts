import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
test.use({ baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined) } });

test('welcome has four steps and optional audio never blocks a browser workspace', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  const guide = page.getByRole('dialog', { name: 'Welcome setup guide' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('list', { name: 'Setup progress' }).locator('li')).toHaveCount(4);
  await guide.getByLabel('What should we call you?').fill('Sam');
  await guide.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(guide.getByText('What is saved where?')).toBeVisible();
  await expect(guide.getByText(/Script backups do not include audio/)).toBeVisible();
  await guide.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(guide.getByText('Choose how you want to use audio')).toBeVisible();
  await expect(guide.getByText(/paid feature|upgrade to pro/i)).toHaveCount(0);
  await guide.getByRole('button', { name: 'Continue to workspace' }).click();
  await guide.getByRole('button', { name: 'Go to my library' }).click();
  await expect(guide).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quickque_profile')!).onboardingComplete)).toBe(true);
});

test('settings separates licence, audio and storage controls with keyboard tabs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Sam', onboardingComplete: true })));
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('tab')).toHaveCount(5);
  await expect(settings.getByRole('switch', { name: 'Licensed mode' })).toHaveCount(0);
  await settings.getByRole('textbox', { name: 'Licence key' }).fill('QQ-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
  await expect(settings.getByRole('button', { name: 'Activate licence' })).toBeEnabled();
  await settings.getByRole('button', { name: 'Activate licence' }).click();
  await expect(settings.getByText(/install the latest Mac release/i)).toBeVisible();
  await settings.getByRole('tab', { name: 'Voices & audio' }).click();
  await expect(settings.getByText('1. Download the voice model')).toBeVisible();
  await expect(settings.getByText('Voice Follow · Scroll as you speak')).toBeVisible();
  await settings.getByRole('tab', { name: 'Storage & backups' }).click();
  await expect(settings.getByRole('button', { name: 'Export script backup' })).toBeVisible();
  await settings.getByRole('tab', { name: 'Help & diagnostics' }).click();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('AI trial stops at the remaining audible time and presents real upgrade choices', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Sam', onboardingComplete: true })));
  await page.reload();
  const result = await page.evaluate(async () => {
    const { PreparedScriptAudio } = await import('/src/lib/script-audio.ts');
    let finish: () => void = () => {};
    let duration: number | undefined;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => {
      if (cmd === 'script_audio_entitlement') return { available: true, paid: false };
      if (cmd === 'script_audio_status') return { status: 'ready', entries: [] };
      if (cmd === 'script_audio_read') return [0];
      if (cmd === 'licence_status') return { status: 'unlicensed', configured: false };
      throw new Error(cmd);
    }};
    class Context {
      currentTime = 0; state = 'running'; destination = {};
      async resume() {} async close() { this.state = 'closed'; }
      async decodeAudioData() { return { length: 1, numberOfChannels: 1, duration: 60 }; }
      createBufferSource() {
        const context = this;
        return { onended: null as (() => void) | null, connect() {}, disconnect() {}, stop() {}, start(_when: number, _offset: number, seconds: number) { duration = seconds; finish = () => { context.currentTime += seconds; this.onended?.(); }; queueMicrotask(finish); } };
      }
    }
    (window as any).AudioContext = Context;
    const request = { scriptId: 'trial-test', revision: 'one', entries: [{ id: 'line', text: 'Hello', voiceId: 'chatterbox-turbo:default-en', rate: 1 }] };
    const player = new PreparedScriptAudio(request);
    let error = '';
    try { await player.speak('Hello', { engine: 'turbo', voiceId: request.entries[0].voiceId, rate: 1 }, new AbortController().signal); } catch (reason) { error = String(reason); }
    await player.dispose();
    return { duration, error };
  });
  expect(result.duration).toBe(30);
  expect(result.error).toContain('AUDIO_TRIAL_LIMIT');
  const upgrade = page.getByRole('dialog', { name: 'Keep going with Quickque Pro' });
  await expect(upgrade).toBeVisible();
  await expect(upgrade.getByRole('button', { name: /Monthly/ })).toBeVisible();
  await upgrade.getByRole('button', { name: /Lifetime/ }).click();
  await expect(upgrade.getByText(/Lifetime checkout is not connected/)).toBeVisible();
  await upgrade.getByRole('button', { name: 'I have a licence key' }).click();
  await upgrade.getByRole('textbox', { name: 'Licence key' }).fill('QQ-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
  await expect(upgrade.getByRole('button', { name: 'Activate licence' })).toBeEnabled();
  await upgrade.getByRole('button', { name: 'Continue with Free' }).click();
  await expect(upgrade).toHaveCount(0);
});

test('sidebar upgrade opens the existing licence choices', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Sam', onboardingComplete: true }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
  });
  await page.reload();
  await page.getByRole('button', { name: /Quickque Free.*Unlock every feature.*Upgrade/ }).click();
  const upgrade = page.getByRole('dialog', { name: 'Keep going with Quickque Pro' });
  await expect(upgrade).toBeVisible();
  await expect(upgrade.getByRole('button', { name: /Monthly/ })).toBeVisible();
  await expect(upgrade.getByRole('button', { name: /Lifetime/ })).toBeVisible();
});
