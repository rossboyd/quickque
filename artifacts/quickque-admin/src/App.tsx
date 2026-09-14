import { useState, type FormEvent } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { AdminAuthProvider, useAdminAuth } from "@/lib/admin-auth";
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import Dashboard from '@/pages/dashboard';
import Licences from '@/pages/licences';
import LicenceDetail from '@/pages/licence-detail';
import NotFound from '@/pages/not-found';
import { Sidebar } from "@/components/layout/sidebar";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function SignInPage() {
  const { email, loading, login } = useAdminAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && email) return <Redirect to="/dashboard" />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login("rossboyd@live.com", password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm border border-border bg-card p-8">
        <img src={`${basePath}/logo.svg`} alt="" className="mb-8 h-10 w-10" />
        <h1 className="text-2xl font-bold tracking-tight">Quickque Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">Private operations console</p>
        <label htmlFor="email" className="mt-8 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</label>
        <input id="email" value="rossboyd@live.com" disabled className="mt-2 h-10 w-full border border-border bg-muted px-3 font-mono text-sm text-muted-foreground" />
        <label htmlFor="password" className="mt-5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={event => setPassword(event.target.value)}
          className="mt-2 h-10 w-full border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={submitting || loading} className="mt-6 h-10 w-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function HomeRedirect() {
  const { loading, email } = useAdminAuth();
  if (loading) return <div className="min-h-[100dvh] bg-background" />;
  return <Redirect to={email ? "/dashboard" : "/sign-in"} />;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar />
      <main className="flex-1 border-l border-border bg-card">
        {children}
      </main>
    </div>
  );
}

function ProtectedRoute({ component: Component, path }: { component: React.ComponentType, path: string }) {
  const { loading, email } = useAdminAuth();
  return (
    <Route path={path}>
      {loading ? <div className="min-h-[100dvh] bg-background" /> : email ? (
        <ProtectedLayout><Component /></ProtectedLayout>
      ) : <Redirect to="/sign-in" />}
    </Route>
  );
}

function Routes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in" component={SignInPage} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/licences" component={Licences} />
      <ProtectedRoute path="/licences/:id" component={LicenceDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WouterRouter base={basePath}>
        <QueryClientProvider client={queryClient}>
          <AdminAuthProvider>
            <TooltipProvider>
              <Routes />
              <Toaster />
            </TooltipProvider>
          </AdminAuthProvider>
        </QueryClientProvider>
      </WouterRouter>
    </ErrorBoundary>
  );
}