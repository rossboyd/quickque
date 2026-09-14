import React, { createContext, useContext } from 'react';

export interface SiteArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  body: string;
  [key: string]: unknown;
}

export interface SiteConfig {
  repository: string;
  branch: string;
  basePath: string;
  demoUrl: string;
  productionOrigin: string | null;
  guideVersion: string;
  sourceCommand: string;
  commerce: {
    name: string;
    amount: number;
    currency: string;
    displayPrice: string;
    billing: string;
    licence: string;
    updates: string;
    sourceLicence: string;
    liveEnabled: boolean;
    monthlyAmount: number;
    monthlyDisplayPrice: string;
    freeVoiceFollowSeconds: number;
    voiceFollowLimitScope: string;
    entitlementsLive: boolean;
  };
  release: {
    status: string;
    tag?: string;
    assetName?: string;
    downloadPageUrl?: string;
    downloadUrl?: string;
    minimumMacOS?: string;
    architecture?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SiteData {
  config: SiteConfig;
  articles: SiteArticle[];
  license: string;
}

export const SiteDataContext = createContext<SiteData | null>(null);

export function SiteDataProvider({
  data,
  children
}: {
  data: SiteData | null;
  children: React.ReactNode;
}) {
  return <SiteDataContext.Provider value={data}>{children}</SiteDataContext.Provider>;
}

export function useSiteData() {
  return useContext(SiteDataContext);
}