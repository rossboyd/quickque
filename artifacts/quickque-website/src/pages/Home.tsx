import React from 'react';
import { Link } from 'wouter';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';
import { Copy, Check, Terminal } from 'lucide-react';

function TerminalInstall({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const codeRef = React.useRef<HTMLElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setFeedback('Commands copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopied(false);
      const range = document.createRange();
      if (codeRef.current) {
        range.selectNodeContents(codeRef.current);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      setFeedback('Copy was blocked. The commands are selected; use your device’s Copy action.');
    }
  };

  return (
    <div className="mt-8 max-w-2xl mx-auto w-full text-left relative group">
      <div className="bg-[#0f1524] text-white p-4 rounded-lg shadow-sm border border-[#232b3d] text-sm font-mono overflow-x-auto">
        <div className="flex items-center gap-2 mb-2 text-[#8b99b0]">
          <Terminal size={14} />
          <span>Build from source (Mac Apple Silicon)</span>
        </div>
        <pre tabIndex={0} className="whitespace-pre-wrap break-all leading-relaxed pb-10"><code ref={codeRef}>{command}</code></pre>
      </div>
      <button 
        onClick={handleCopy}
        className="absolute top-3 right-3 p-1.5 bg-[#232b3d] text-white border border-[#232b3d] rounded text-xs hover:bg-[#323d54] transition-colors flex items-center gap-1"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} className="text-[#6495ed]" /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <p role="status" className="text-sm mt-2 font-sans text-[var(--text-muted)]">{feedback}</p>
    </div>
  );
}

export function HomePage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  
  return (
    <div className="w-full">
      <Meta 
        title="Local-first teleprompter" 
        description="Float your notes right over the meeting. Quickque’s compact, transparent Mac teleprompter keeps your script in view without filling your screen. Build from source."
        context={context} 
      />
      {/* Hero */}
      <section className="max-w-[1400px] mx-auto px-6 lg:px-12 py-20 lg:py-32 flex flex-col lg:flex-row items-center lg:items-start gap-16 lg:gap-24 relative overflow-hidden">
        
        {/* Left: Content */}
        <div className="flex-1 w-full flex flex-col items-center lg:items-start text-center lg:text-left pt-8 lg:pt-16 z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/50 backdrop-blur border border-[var(--border)] text-sm text-[var(--accent)] font-medium mb-8 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            Compact. Transparent. Made for Mac.
          </div>
          
          <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl xl:text-[5.5rem] tracking-tight text-[var(--foreground)] mb-8 max-w-3xl leading-[1.1]">
            Float your notes <span className="text-[var(--accent)] block mt-2">right over the meeting.</span>
          </h1>
          <p className="text-lg sm:text-xl text-[var(--text-muted)] max-w-2xl mb-12 font-sans">
            Your script, without a screenful of distraction. Float a compact, transparent prompter over your call, position it near your camera, and keep the conversation in view.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center lg:justify-start mb-8">
            <Link href="/pricing" className="px-8 py-4 bg-[var(--accent)] text-white rounded-2xl font-medium hover:bg-[var(--accent-hover)] transition-all shadow-[0_8px_20px_-6px_rgba(51,74,179,0.4)] hover:shadow-[0_12px_24px_-8px_rgba(51,74,179,0.5)] hover:-translate-y-0.5 text-lg">
              Get Quickque for Mac
            </Link>
            <Link href="/guide" className="px-8 py-4 bg-white text-[var(--foreground)] border border-[var(--border)] rounded-2xl font-medium hover:bg-[var(--surface-hover)] transition-all shadow-sm text-lg">
              Read the manual
            </Link>
          </div>
          
          <div className="mt-2 flex flex-col items-center lg:items-start gap-4">
            <p className="text-sm text-[var(--text-muted)] font-medium">One-time purchase, yours forever. Or <Link href="/install" className="underline text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">build from source for free</Link>.</p>
            {config?.release?.status === 'unavailable' && (
              <div className="inline-flex items-start gap-3 p-4 bg-[#f8f9fc] border border-[#e2e6ec] rounded-2xl text-sm text-[var(--text-muted)] max-w-xl shadow-sm mt-4">
                <span className="text-xl leading-none pt-0.5 opacity-50">ℹ</span>
                <p>A prebuilt release is currently unavailable. The Mac app must be built from source. Physical-device verification is still outstanding.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Visual */}
        <div className="flex-1 w-full relative z-10">
          <div className="w-full relative aspect-square lg:aspect-auto lg:h-[700px] flex items-center justify-center">
            
            {/* Atmospheric Background blob */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-tr from-[#e6ebfc] to-[#f3f5f8] rounded-full blur-3xl opacity-60 pointer-events-none" />

            {/* Faux Desktop Window Environment */}
            <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] border border-[var(--border)] overflow-hidden flex flex-col relative z-20">
              {/* Window Bar */}
              <div className="h-12 bg-white border-b border-[var(--border)] flex items-center px-4 gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
              </div>
              
              {/* Video Call Simulation */}
              <div className="aspect-[4/3] bg-[#1c1d21] relative flex flex-col p-4 gap-4">
                <div className="grid grid-cols-2 gap-4 h-full">
                  <div className="bg-[#2a2b30] rounded-xl flex items-center justify-center"><div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#3f4048]" /></div>
                  <div className="bg-[#2a2b30] rounded-xl flex items-center justify-center"><div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#3f4048]" /></div>
                  <div className="bg-[#2a2b30] rounded-xl flex items-center justify-center"><div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#3f4048]" /></div>
                  <div className="bg-[#2a2b30] rounded-xl flex items-center justify-center"><div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#3f4048]" /></div>
                </div>

                {/* The Floating UI (Compact Mode) */}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 w-[86%] sm:w-4/5 max-w-sm bg-[#1c1d21]/70 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-6 text-left flex flex-col gap-4 transform rotate-1 hover:rotate-0 transition-transform duration-500 ease-out">
                  <div className="flex justify-between items-center border-b border-white/10 pb-3">
                    <span className="text-[#a8b4ff] text-xs font-mono font-medium tracking-wide uppercase">Quickque · Compact mode</span>
                    <div className="flex gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                    </div>
                  </div>
                  <div className="text-white/95 font-medium text-lg leading-relaxed font-sans">
                    <span className="opacity-40">Welcome everyone. </span>
                    Here’s what we’re working on.
                    <span className="opacity-40"> Your notes stay close. The conversation stays in view.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-10 right-0 text-[#8a8d98] text-sm font-medium flex flex-col items-end gap-1">
              <span>Compact-mode illustration, not a native screenshot.</span>
              <Link href="/guide/mac-overlay" className="underline text-[var(--accent)]">See how it works.</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Terminal Block */}
      {config?.sourceCommand && (
        <section className="border-t border-[var(--border)] bg-[#fafbfd] py-16">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="font-serif text-3xl mb-6 text-center">Ready to build?</h2>
            <TerminalInstall command={config.sourceCommand} />
            <p className="text-center text-sm text-[var(--text-muted)] mt-6 max-w-xl mx-auto">
              Mac source builds need macOS 14+, Apple Silicon, Xcode 16+, stable Rust, Node.js 24, and pnpm 10.26.1. <Link href="/install" className="underline text-[var(--accent)] font-medium">Read the setup steps first.</Link>
            </p>
          </div>
        </section>
      )}

      {/* Product Shots */}
      <section className="bg-white py-32 border-t border-[var(--border)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[#f5f6f8] rounded-full blur-[100px] opacity-50 -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

        <div className="max-w-[1200px] mx-auto px-6 flex flex-col gap-32 relative z-10">
          
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1 lg:pr-12">
              <h2 className="font-serif text-4xl sm:text-5xl mb-6 leading-tight">Organize everything locally.</h2>
              <p className="text-[var(--text-muted)] text-lg sm:text-xl leading-relaxed">
                Your scripts stay strictly on your device. The local library lets you group notes into logical sections so you can navigate them seamlessly during a call. No cloud syncing, no accounts.
              </p>
            </div>
            <div className="flex-[1.5] w-full">
              <div className="bg-white rounded-3xl p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.08)] border border-[var(--border)] transform lg:-rotate-1">
                <div className="rounded-2xl overflow-hidden border border-[#f0f2f5] bg-white">
                  <img src={`${config?.basePath}images/library.webp`} alt="Quickque library view showing sectioned sample scripts" className="w-full h-auto object-cover" width="1360" height="900" loading="lazy" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row-reverse items-center gap-16">
            <div className="flex-1 lg:pl-12">
              <h2 className="font-serif text-4xl sm:text-5xl mb-6 leading-tight">Read at your own pace.</h2>
              <p className="text-[var(--text-muted)] text-lg sm:text-xl leading-relaxed">
                The reader view is built for speaking. Scripts are broken into manual sections. If you get interrupted by a question, you don't lose your place. Just pause, handle the question, and resume exactly where you were.
              </p>
            </div>
            <div className="flex-[1.5] w-full">
              <div className="bg-white rounded-3xl p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.08)] border border-[var(--border)] transform lg:rotate-1">
                <div className="rounded-2xl overflow-hidden border border-[#f0f2f5] bg-white">
                  <img src={`${config?.basePath}images/reader.webp`} alt="Quickque reader view" className="w-full h-auto object-cover" width="1360" height="900" loading="lazy" />
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-[#f5f6f8] border-t border-[var(--border)] py-32">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="font-serif text-4xl sm:text-5xl mb-16 text-center max-w-2xl mx-auto">Built for people who present from their desk.</h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white p-10 rounded-[2rem] shadow-sm border border-[var(--border)] hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#e6ebfc] rounded-xl flex items-center justify-center text-[var(--accent)] mb-8 text-xl">1</div>
              <h3 className="font-serif text-3xl mb-4">Manual sections</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                Scripts are divided into sections. If you get interrupted, you don't lose your place. Just pause, handle the question, and resume exactly where you were.
              </p>
            </div>
            
            <div className="bg-white p-10 rounded-[2rem] shadow-sm border border-[var(--border)] hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#e6ebfc] rounded-xl flex items-center justify-center text-[var(--accent)] mb-8 text-xl">2</div>
              <h3 className="font-serif text-3xl mb-4">Native Mac overlay</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                Less window, more conversation. Compact mode gives you a small, always-on-top prompter with adjustable transparency. Place it over your meeting window so your script is close without taking over the screen. Mac-device verification is still outstanding.
              </p>
            </div>
            
            <div className="bg-white p-10 rounded-[2rem] shadow-sm border border-[var(--border)] hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#e6ebfc] rounded-xl flex items-center justify-center text-[var(--accent)] mb-8 text-xl">3</div>
              <h3 className="font-serif text-3xl mb-4">Optional local Flow</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                An offline speech recognition and alignment model that follows along as you speak English. Explicitly downloaded on-demand. It runs entirely on your Mac's Apple Silicon.
              </p>
            </div>
            
            <div className="bg-white p-10 rounded-[2rem] shadow-sm border border-[var(--border)] hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#e6ebfc] rounded-xl flex items-center justify-center text-[var(--accent)] mb-8 text-xl">4</div>
              <h3 className="font-serif text-3xl mb-4">LAN phone remote</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                Scan a local QR code and approve your phone on the Mac. Both devices need the same reachable, trusted LAN. Remote traffic uses unencrypted HTTP—not a public relay.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white border-t border-[var(--border)] py-32">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="font-serif text-4xl sm:text-5xl mb-16 text-center">Frequently asked questions</h2>
          
          <div className="flex flex-col gap-10">
            <div className="pb-10 border-b border-[var(--border)] last:border-0 last:pb-0">
              <h3 className="text-xl font-semibold mb-4 text-[var(--foreground)]">Is there a Windows or Linux version?</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                Native builds target Apple Silicon Macs running macOS 14 or newer, not Intel, Windows, or Linux. The manual browser reader can be run from source separately.
              </p>
            </div>
            
            <div className="pb-10 border-b border-[var(--border)] last:border-0 last:pb-0">
              <h3 className="text-xl font-semibold mb-4 text-[var(--foreground)]">Do I need an account?</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                No. Quickque is entirely local-first. Your scripts stay on your machine, and your audio never leaves your device.
              </p>
            </div>

            <div className="pb-10 border-b border-[var(--border)] last:border-0 last:pb-0">
              <h3 className="text-xl font-semibold mb-4 text-[var(--foreground)]">Can I import Word or PDF files?</h3>
              <p className="text-[var(--text-muted)] text-lg leading-relaxed">
                Yes. Quickque extracts plain text from TXT, DOCX, RTF, and text-based PDFs natively on your device. It does not perform OCR on scanned images.
              </p>
            </div>
          </div>
        </div>
      </section>
      
      <section className="max-w-4xl mx-auto px-6 py-32 text-center">
        <div className="bg-[#f5f6f8] rounded-[3rem] p-16 border border-[var(--border)] shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-[#e6ebfc] to-transparent rounded-full blur-[80px] opacity-40 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
          <div className="relative z-10">
            <h2 className="font-serif text-4xl sm:text-5xl mb-6">Try it on your own terms.</h2>
            <p className="text-xl mb-12 text-[var(--text-muted)] max-w-2xl mx-auto">Quickque-owned code and documentation are MIT licensed. Buy the pre-built Mac application, read the guide, or build it yourself when you’re ready.</p>
            <div className="flex flex-wrap justify-center gap-8 items-center">
              <Link href="/pricing" className="px-6 py-3 bg-[var(--accent)] text-white rounded-xl font-medium hover:bg-[var(--accent-hover)] transition-colors shadow-sm">See pricing</Link>
              <Link href="/install" className="text-lg font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">Build from source</Link>
              <Link href="/guide" className="text-lg font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">User guide</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}