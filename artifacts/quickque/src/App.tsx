import { useEffect, type ReactNode } from 'react';
import { FlowDebugOverlay } from '@/components/flow-debug-overlay';
import { WelcomeWizard } from '@/components/welcome-wizard';
import { recordFlowDebug } from '@/lib/flow/diagnostics';
import { isDesktop } from '@/lib/desktop';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { StoreProvider } from '@/lib/store';
import Library from '@/pages/library';
import Reader from '@/pages/reader';

const routerBase =
  import.meta.env.BASE_URL === './'
    ? ''
    : import.meta.env.BASE_URL.replace(/\/$/, '');

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Library} />
        <Route path="/read/:id">{params => <Reader key={params.id} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    recordFlowDebug(isDesktop() ? 'ui_desktop' : 'ui_browser');
  }, []);
  return (
    <>
    <FlowDebugOverlay />
    <StoreProvider>
      <div className="contents" data-quickque-ready>
        <TooltipProvider>
          <WouterRouter base={routerBase}>
            <Router />
            <WelcomeWizard />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </div>
    </StoreProvider>
    </>
  );
}

export default App;
