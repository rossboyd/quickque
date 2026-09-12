(() => {
  const root = document.getElementById('root');
  let startupError = '';

  const describe = (value) => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    return 'The packaged interface did not start.';
  };

  window.addEventListener('error', (event) => {
    startupError = describe(event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    startupError = describe(event.reason);
  });

  window.setTimeout(() => {
    if (!root || root.querySelector('[data-quickque-ready]')) return;

    const message = document.createElement('div');
    message.style.cssText =
      'min-height:100vh;display:flex;box-sizing:border-box;align-items:center;justify-content:center;padding:32px;color:#e2e8f0;background:#0f1724;font:14px system-ui,sans-serif;text-align:center;white-space:pre-wrap';
    message.textContent = `Quickque could not start.\n${startupError || 'No startup error was reported.'}`;
    root.replaceChildren(message);
  }, 5000);
})();