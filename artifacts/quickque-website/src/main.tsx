import React from 'react';
import { SiteDataProvider, type SiteData } from './lib/site-data';
import { Router } from 'wouter';
import { App } from './App';

function parseSiteDataScript(): SiteData | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById('site-data');
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as SiteData;
  } catch {
    return null;
  }
}

export function ClientApp({ siteData }: { siteData: SiteData | null }) {
  const configuredBasePath = siteData?.config.basePath.replace(/\/+$/, '');
  const basePath = siteData ? (configuredBasePath || '') : '';
  return (
    <SiteDataProvider data={siteData}>
      <Router base={basePath}>
        <App />
      </Router>
    </SiteDataProvider>
  );
}

export function readInitialSiteData() {
  return parseSiteDataScript();
}