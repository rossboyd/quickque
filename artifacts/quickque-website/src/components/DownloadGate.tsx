import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, CheckCircle2, ExternalLink, Monitor } from 'lucide-react';
import { useSiteConfig } from '../hooks/useData';

type DeviceCheck = {
  kind: 'mac' | 'not-mac' | 'unknown';
  architecture: 'apple-silicon' | 'intel' | 'unknown';
  macOS: number | null;
};

function inspectDevice(): DeviceCheck {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform || '';
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { platform?: string; architecture?: string };
  }).userAgentData;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const isMac = !isAppleMobile && (/Macintosh|Mac OS X/i.test(userAgent) || /Mac/i.test(platform) || userAgentData?.platform === 'macOS');
  const architectureValue = `${userAgentData?.architecture || ''} ${userAgent} ${platform}`.toLowerCase();
  const architecture = /arm64|aarch64|apple silicon/i.test(architectureValue)
    ? 'apple-silicon'
    : /x86_64|win64|intel/i.test(architectureValue)
      ? 'intel'
      : 'unknown';
  const versionMatch = userAgent.match(/Mac OS X[ /](\d+)[_.](\d+)(?:[_.](\d+))?/i);
  // Safari and several Chromium builds intentionally retain the legacy
  // "10_15_7" compatibility token on current macOS versions. Treat only
  // modern-looking values as a real OS-version signal.
  const parsedMacOS = versionMatch ? Number(`${versionMatch[1]}.${versionMatch[2]}`) : null;
  const macOS = parsedMacOS !== null && parsedMacOS >= 20 ? parsedMacOS : null;

  return {
    kind: isMac ? 'mac' : 'not-mac',
    architecture: isMac ? architecture : 'unknown',
    macOS: isMac ? macOS : null,
  };
}

export function DownloadGate({ compact = false }: { compact?: boolean }) {
  const { config } = useSiteConfig();
  const [device, setDevice] = useState<DeviceCheck | null>(null);
  const release = config?.release;

  useEffect(() => {
    setDevice(inspectDevice());
  }, []);

  if (!release?.downloadUrl) return null;

  const isClearlyUnsupported = device?.kind === 'not-mac' || device?.architecture === 'intel' || (device?.macOS != null && device.macOS < 26);
  const canVerifyCompatibility = device?.kind === 'mac' && device.architecture === 'apple-silicon' && device.macOS !== null && device.macOS >= 26;
  const status = !device
    ? 'checking'
    : isClearlyUnsupported
      ? 'unsupported'
      : canVerifyCompatibility
        ? 'compatible'
        : 'advisory';

  const handleDownload = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (status === 'unsupported') {
      event.preventDefault();
      return;
    }
    if (status === 'advisory' && !window.confirm('Your browser could not verify every requirement. Quickque requires an Apple Silicon Mac running macOS 26 or newer. Continue to the DMG download?')) {
      event.preventDefault();
    }
  };

  return (
    <section id="download" className={`download-card ${compact ? 'download-card-compact' : ''}`} aria-labelledby="download-title">
      <div className="download-card-copy">
        <span className="eyebrow dark-eyebrow"><Monitor size={14} /> APPLE SILICON RELEASE</span>
        <h2 id="download-title">Download Quickque for Mac.</h2>
        <p>Quickque requires an Apple Silicon Mac running macOS 26 or newer. This is an unsigned test DMG; macOS may require Finder’s Control-click → <strong>Open</strong> flow on first launch.</p>
      </div>
      <div className="download-card-action">
        {status === 'checking' && <p className="download-status" role="status">Checking this device…</p>}
        {status === 'compatible' && <p className="download-status download-status-good"><CheckCircle2 size={16} /> Your browser reports a compatible Mac.</p>}
        {status === 'unsupported' && <p className="download-status download-status-warning"><AlertTriangle size={16} /> This does not look like a supported Mac. The download is disabled.</p>}
        {status === 'advisory' && <p className="download-status download-status-warning"><AlertTriangle size={16} /> Compatibility could not be fully verified. The download remains available with a warning.</p>}
        <a
          href={release.downloadUrl}
          onClick={handleDownload}
          aria-disabled={status === 'unsupported'}
          className={`premium-button button-dark download-button ${status === 'unsupported' ? 'download-button-disabled' : ''}`}
        >
          <ArrowDownToLine size={17} /> Download {release.assetName || 'the DMG'}
        </a>
        {release.downloadPageUrl && <a href={release.downloadPageUrl} target="_blank" rel="noreferrer" className="download-release-link">View release notes <ExternalLink size={13} /></a>}
        <small>Browser detection is advisory and can be unavailable or spoofed. Confirm your Mac meets the requirements before installing.</small>
      </div>
    </section>
  );
}