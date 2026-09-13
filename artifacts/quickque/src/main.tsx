import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { applyPersistedTheme } from '@/lib/settings-persistence';

import './index.css';

// The static startup path applies this even earlier; repeating it here keeps
// direct module entry points and test mounts on the same no-flash contract.
applyPersistedTheme();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <div data-quickque-mounted>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>,
);
