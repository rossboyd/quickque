(() => {
  const root = document.getElementById('root');
  let startupError = '';
  const MAX_ERROR_LENGTH = 240;

  const bounded = (value, fallback) => {
    const message =
      value instanceof Error
        ? value.message
        : typeof value === 'string'
          ? value
          : '';
    const normalized = message.trim() || fallback;
    return normalized.length <= MAX_ERROR_LENGTH
      ? normalized
      : `${normalized.slice(0, MAX_ERROR_LENGTH - 1).trim()}…`;
  };

  // This runs before the React module is fetched/painted. Keep it deliberately
  // dependency-free so a persisted light theme cannot flash dark (or vice
  // versa) while settings and the native library hydrate.
  let darkTheme = true;
  try {
    const raw = window.localStorage.getItem('quickque_settings');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.darkTheme === 'boolean') {
        darkTheme = parsed.darkTheme;
      }
    }
  } catch {
    // Defaults are safe when storage is unavailable or malformed.
  }
  document.documentElement.classList.toggle('dark', darkTheme);
  document.documentElement.setAttribute(
    'data-quickque-theme',
    darkTheme ? 'dark' : 'light',
  );
  if (root) {
    const initialShell = root.firstElementChild;
    if (
      initialShell &&
      typeof HTMLElement !== 'undefined' &&
      initialShell instanceof HTMLElement
    ) {
      initialShell.style.color = darkTheme ? '#e2e8f0' : '#1f2937';
      initialShell.style.background = darkTheme ? '#0f1724' : '#f8fafc';
    }
  }

  const describe = (value) => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    return 'The packaged interface did not start.';
  };

  window.addEventListener('error', (event) => {
    startupError = bounded(
      describe(event.error || event.message),
      'The packaged interface did not start.',
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    startupError = bounded(
      describe(event.reason),
      'The packaged interface did not start.',
    );
  });

  window.setTimeout(() => {
    if (
      !root ||
      root.querySelector('[data-quickque-ready]') ||
      root.querySelector('[data-quickque-startup-error]')
    ) {
      return;
    }

    const message = document.createElement('div');
    message.style.cssText =
      'min-height:100vh;display:flex;box-sizing:border-box;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;color:var(--foreground,#e2e8f0);background:var(--background,#0f1724);font:14px system-ui,sans-serif;text-align:center;white-space:pre-wrap';
    const mounted = root.querySelector('[data-quickque-mounted]');
    const heading = document.createElement('strong');
    heading.textContent = mounted
      ? 'Quickque is still loading local data.'
      : 'Quickque could not mount.';
    const detail = document.createElement('span');
    detail.textContent = bounded(
      mounted
        ? 'The cached library or native bridge did not finish in time. Retry Quickque to try again.'
        : startupError || 'The packaged interface did not mount. Reload Quickque to try again.',
      'Quickque could not start. Reload Quickque to try again.',
    );
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reload Quickque';
    retry.style.cssText =
      'border:0;border-radius:6px;padding:8px 12px;background:#6675e8;color:#fff;font:inherit;cursor:pointer';
    retry.addEventListener('click', () => window.location.reload());
    message.append(heading, detail, retry);
    if (mounted && document.body) {
      // Never replace a React-managed root. A slow native bridge may still
      // resolve after the watchdog deadline and React must be able to publish
      // the ready marker normally.
      message.id = 'quickque-startup-watchdog';
      message.style.position = 'fixed';
      message.style.inset = '0';
      message.style.zIndex = '2147483647';
      document.body.appendChild(message);
      const dismiss = () => {
        if (
          root.querySelector('[data-quickque-ready]') ||
          root.querySelector('[data-quickque-startup-error]')
        ) {
          message.remove();
          observer?.disconnect();
        }
      };
      const observer =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(dismiss);
      observer?.observe(root, { childList: true, subtree: true, attributes: true });
      dismiss();
    } else {
      root.replaceChildren(message);
    }
  }, 5000);
})();