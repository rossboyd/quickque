import React from 'react';
import { Route, Switch } from 'wouter';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { InstallPage } from './pages/Install';
import { GuideIndexPage } from './pages/GuideIndex';
import { GuideArticlePage } from './pages/GuideArticle';
import { PrivacyPage } from './pages/Privacy';
import { LicensePage } from './pages/License';
import { NotFoundPage } from './pages/NotFound';
import { PricingPage } from './pages/Pricing';
import { CheckoutResultPage } from './pages/CheckoutResult';
import { SupportPage } from './pages/Support';
import { ReleaseNotesPage } from './pages/ReleaseNotes';

export function App({ context }: { context?: any }) {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <HomePage context={context} />} />
        <Route path="/install" component={() => <InstallPage context={context} />} />
        <Route path="/pricing" component={() => <PricingPage context={context} />} />
        <Route path="/checkout/result" component={() => <CheckoutResultPage context={context} />} />
        <Route path="/guide" component={() => <GuideIndexPage context={context} />} />
        <Route path="/guide/:slug" component={() => <GuideArticlePage context={context} />} />
        <Route path="/privacy" component={() => <PrivacyPage context={context} />} />
        <Route path="/license" component={() => <LicensePage context={context} />} />
        <Route path="/support" component={() => <SupportPage context={context} />} />
        <Route path="/release-notes" component={() => <ReleaseNotesPage context={context} />} />
        <Route path="/changelog" component={() => <ReleaseNotesPage context={context} />} />
        <Route component={() => {
          if (context) context.status = 404;
          return <NotFoundPage context={context} />;
        }} />
      </Switch>
    </Layout>
  );
}