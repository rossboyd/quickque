import type { HydrationPhase } from '@/lib/startup';

type StartupShellProps = {
  phase: HydrationPhase;
  error?: string | null;
  onRetry?: () => void;
  onContinue?: () => void;
};

export function StartupShell({
  phase,
  error,
  onRetry,
  onContinue,
}: StartupShellProps) {
  const failed = phase === 'error';
  return (
    <main
      className="quickque-startup-shell"
      data-quickque-startup-error={failed ? '' : undefined}
      data-quickque-hydration={phase}
      role={failed ? 'alert' : undefined}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="quickque-startup-mark" aria-hidden="true">
        Q
      </div>
      <p className="quickque-startup-title">
        {failed ? 'Quickque could not finish starting' : 'Starting Quickque…'}
      </p>
      <p className="quickque-startup-detail">
        {failed
          ? error || 'Your cached scripts are safe. Retry the local library connection or continue with cached data.'
          : 'Preparing your settings and local library.'}
      </p>
      {failed && (
        <div className="quickque-startup-actions">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
          <button type="button" className="quickque-startup-secondary" onClick={onContinue}>
            Continue with cached data
          </button>
        </div>
      )}
    </main>
  );
}