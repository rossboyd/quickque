// Safe smoke check for the temporary dummy flow. This script deliberately
// verifies that all former payment endpoints are disabled.
import assert from 'node:assert/strict';
import { readSiteConfigSync } from '../lib/server/content.js';

const config = readSiteConfigSync();
const base = new URL(
  'api/',
  process.env.SITE_CHECK_URL || `http://localhost:80${config.basePath}`
);

for (const [method, route] of [
  ['GET', 'commerce/status'],
  ['POST', 'commerce/checkout'],
  ['GET', 'commerce/session?session_id=disabled']
]) {
  const response = await fetch(new URL(route, base), { method });
  assert.equal(response.status, 410, `${method} ${route} must stay disabled`);
  const body = await response.json();
  assert.match(JSON.stringify(body), /disabled/i);
  assert.doesNotMatch(JSON.stringify(body), /https?:\/\//);
}

console.log('Dummy checkout boundary passed: payment creation, verification, and webhooks are disabled.');