import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ClientApp, readInitialSiteData } from './main';
import './index.css';

const root = document.getElementById('root');
if (root) {
  hydrateRoot(
    root,
    <React.StrictMode>
      <ClientApp siteData={readInitialSiteData()} />
    </React.StrictMode>
  );
}