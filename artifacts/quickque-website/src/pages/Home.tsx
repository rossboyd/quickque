import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Check, ChevronRight, Command, Layers3, LockKeyhole, Maximize2, Mic, Monitor, Pause, Play, Plus, Smartphone, Sparkles } from 'lucide-react';
import { Meta } from '../components/Meta';
import { FlowMesh } from '../components/FlowMesh';
import { TerminalInstall } from '../components/TerminalInstall';
import { useSiteConfig } from '../hooks/useData';

function ProductPreview() {
  const [mode, setMode] = useState<'presentation' | 'performance'>('presentation');
  const [step, setStep] = useState(0);
  const lines = mode === 'presentation'
    ? ['Good ideas deserve to be heard.', 'So take a breath. Find your rhythm.', 'And make this moment yours.']
    : ['I thought you might come back.', 'Some things are worth a second chance.', 'Then let’s start from the beginning.'];
  return <div className="product-preview" data-parallax="-0.04">
    <div className="preview-windowbar"><span className="window-dots"><i /><i /><i /></span><span>Quickque</span><Maximize2 size={13} /></div>
    <div className="preview-body">
      <div className="preview-sidebar"><span className="micro-label">YOUR LIBRARY</span><div className="preview-script selected"><span><Layers3 size={14} />The next big idea</span><small>{mode === 'presentation' ? 'Presentation' : 'Performance'}</small></div><div className="preview-script"><span><Layers3 size={14} />A little introduction</span><small>Presentation</small></div><div className="preview-library-note"><LockKeyhole size={12} /> Saved on your Mac</div></div>
      <div className="preview-reader">
        <div className="preview-mode" role="group" aria-label="Explore a product mode">
          {(['presentation', 'performance'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setStep(0); }}>{value === 'presentation' ? 'Presentation' : 'Performance'}</button>)}
        </div>
        <div className="preview-readout"><span className="micro-label">{mode === 'presentation' ? 'FIND YOUR FLOW' : step % 2 ? 'ALEX · YOUR TURN' : 'JAMIE · PARTNER LINE'}</span><p key={`${mode}-${step}`}>{lines[step]}</p><span className="preview-next-line">{lines[(step + 1) % lines.length]}</span></div>
        <div className="preview-transport"><span><i />{mode === 'presentation' ? 'Your pace. Your words.' : 'A scene partner. On your Mac.'}</span><button aria-label="Next demo line" onClick={() => setStep((step + 1) % lines.length)}><span>Next line</span><ChevronRight size={17} /></button></div>
      </div>
    </div>
    <div className="preview-caption">Interactive product illustration · no microphone or recording</div>
  </div>;
}

const features = [
  { icon: Monitor, title: 'Stay close to the camera.', text: 'A compact, transparent Mac overlay keeps your words near your eyeline and your conversation in view.', link: 'mac-overlay', label: 'Explore compact mode' },
  { icon: AudioLines, title: 'A little more flow.', text: 'Optional on-device English voice following moves with your speech on macOS Tahoe 26+. Pause explicitly for interruptions, then resume when you’re ready.', link: 'local-flow', label: 'Meet local Flow' },
  { icon: Smartphone, title: 'Your phone. Your remote.', text: 'Move through your script from your phone, paired with your Mac on the same trusted local network.', link: 'phone-remote', label: 'See remote setup' },
];
const questions = [
  ['What do I need to run Quickque?', 'The native app targets Apple Silicon Macs running macOS 14 or newer. A prebuilt release is not currently available; installation is through a source build. The install guide covers the tools you need.'],
  ['Do my scripts or voice go to the cloud?', 'No. Scripts stay on your device, and optional Flow speech recognition runs locally on your Mac on macOS Tahoe 26+ after you approve the Apple-managed language-asset download. No Quickque account is needed to use the app.'],
  ['Can I use it for a self-tape?', 'Scene Partner reads the other characters while you perform your role. Record your self-tape on a separate phone or camera: Quickque does not record audio or video. Native scene audio still needs physical-device verification.'],
  ['Can I bring my existing scripts?', 'Yes. Import TXT, DOCX, RTF, and text-based PDFs. Quickque extracts the text locally; scanned PDFs need OCR elsewhere first.'],
  ['Is it a subscription?', 'No. The planned Mac package is a one-time purchase. You can use the purchased version forever; future major upgrades may cost extra. Quickque-owned source code remains available under the MIT licence.'],
];

export function HomePage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(min-width: 900px)');
    const targets = [...root.querySelectorAll<HTMLElement>('[data-parallax]')];
    let frame = 0;
    const draw = () => {
      frame = 0;
      for (const target of targets) {
        const enabled = !reduced.matches && !motionPaused && desktop.matches;
        const rect = target.getBoundingClientRect();
        const offset = enabled ? Math.max(-35, Math.min(35, (rect.top - innerHeight * .5) * Number(target.dataset.parallax))) : 0;
        target.style.setProperty('--parallax-y', `${offset}px`);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    reduced.addEventListener('change', schedule);
    draw();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); reduced.removeEventListener('change', schedule); };
  }, [motionPaused]);

  return <div ref={rootRef} className="premium-home" data-motion-paused={motionPaused}>
    <Meta title="Local-first teleprompter" description="Your words. Your rhythm. Quickque is a local-first Mac teleprompter for presentations, conversations and performances. Explore compact mode and local voice following." context={context} />
    <section className="premium-hero">
      <div className="hero-grid" aria-hidden="true" /><FlowMesh paused={motionPaused} /><div className="hero-halo" aria-hidden="true" />
      <div className="hero-content site-container">
        <div className="eyebrow"><span className="status-dot" /> A LITTLE PROMPT. A LOT MORE PRESENCE.</div>
        <h1>Your words.<br /><span>Your rhythm.</span></h1>
        <p className="hero-description">Be in the moment. Keep your words close.<br className="desktop-break" /> The local-first teleprompter made for your Mac.</p>
        <div className="hero-actions"><Link href="/pricing" className="premium-button button-light">Get Quickque for Mac <ArrowUpRight size={18} /></Link><a href="#in-action" className="premium-button button-ghost">See it in action <ArrowDown size={16} /></a></div>
        <div className="hero-footnote"><span className="hero-platform"><Command size={13} /> Apple Silicon · macOS 14+</span><span className="hero-footnote-divider" /><span>No subscription. No cloud.</span></div>
      </div>
      <div className="mesh-annotation" aria-hidden="true"><span className="crosshair">+</span><span>IN YOUR ELEMENT.<br />IN YOUR FLOW.</span><span className="annotation-line" /></div>
      <div className="hero-bottom site-container"><span>BUILT AROUND YOU. NOT THE OTHER WAY ROUND.</span><button className="motion-toggle" aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? <Play size={12} /> : <Pause size={12} />}{motionPaused ? 'Resume motion' : 'Pause motion'}</button></div>
    </section>
    <div className="principles-strip"><div className="site-container"><span><Monitor size={16} /> Made for Mac</span><span><LockKeyhole size={16} /> Private by design</span><span><Layers3 size={16} /> Your scripts, on your device</span><span><Command size={16} /> Open source at heart</span></div></div>
    <section id="in-action" className="product-section site-container section-space">
      <div className="section-heading"><div><span className="eyebrow dark-eyebrow">01 / A NATURAL EXTENSION OF YOU</span><h2>Less looking down.<br /><span>More showing up.</span></h2></div><p>For the pitch you’ve practised.<br />The story you want to tell.<br />And the moment you want to get right.</p></div>
      <div className="product-stage"><div className="stage-grid" aria-hidden="true" /><ProductPreview /><div className="floating-note" data-parallax="0.05"><span className="note-icon"><Check size={18} /></span><span>Your words stay yours.<small>Stored locally. Always within reach.</small></span></div></div>
      <div className="product-subline"><span>One quiet companion. Room for every kind of voice.</span><Link href="/guide">Find your way around <ArrowUpRight size={16} /></Link></div>
    </section>
    <section className="feature-section section-space"><div className="site-container"><div className="section-heading"><div><span className="eyebrow dark-eyebrow">02 / SMALL DETAILS. BIG DIFFERENCE.</span><h2>Stay with<br /><span>the conversation.</span></h2></div><p>Everything you need to feel prepared.<br />Space to sound like yourself.</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, text, link, label }, index) => <article className="premium-feature" key={title}><div className="feature-topline"><Icon size={22} strokeWidth={1.4} /><span>0{index + 1}</span></div><div className={`feature-art feature-art-${index}`} aria-hidden="true">{index === 0 ? <><div className="mini-window"><span /><span /><span /></div><div className="mini-overlay">Here’s the thing.<br /><strong>You’ve got this.</strong></div></> : index === 1 ? <div className="waveform">{Array.from({length:29}, (_, i) => <i key={i} style={{height:`${12 + Math.abs(Math.sin(i * 1.9)) * 48}px`}} />)}</div> : <div className="mini-phone"><span /><div><ChevronRight size={28} /></div><small>YOU’RE IN CONTROL</small></div>}</div><h3>{title}</h3><p>{text}</p><Link href={`/guide/${link}`}>{label}<ArrowUpRight size={16} /></Link></article>)}</div></div></section>
    <section className="performance-section"><div className="site-container performance-grid"><div className="performance-copy"><span className="eyebrow">03 / YOUR CUE TO CREATE</span><h2>A big pitch.<br />A quiet scene.<br /><span>Your moment.</span></h2><p>From presenting an idea to finding a character, keep the script close and the delivery your own.</p><Link href="/guide" className="premium-button button-light">Explore the possibilities <ArrowUpRight size={17} /></Link></div><div className="scene-stack" data-parallax="-0.055"><div className="scene-card scene-partner"><div><span className="role-orb"><AudioLines size={16} /></span><span>JAMIE<small>Scene partner</small></span><span className="scene-tag">PARTNER LINE</span></div><p>“I thought you might<br />come back.”</p></div><div className="scene-card scene-you"><div><span className="role-orb"><Mic size={16} /></span><span>ALEX<small>You’re playing this role</small></span><span className="scene-tag">YOUR TURN</span></div><p>“Some things are worth<br />a second chance.”</p><div className="scene-card-footer"><span className="status-dot" /> TAKE YOUR TIME. THIS IS YOUR LINE.</div></div><p className="scene-disclaimer">Scene Partner illustration. Record on a separate camera.<br />Quickque does not record audio or video.</p></div></div></section>
    <section className="library-section site-container section-space"><div className="library-copy"><span className="eyebrow dark-eyebrow">04 / A HOME FOR YOUR WORDS</span><h2>All your ideas.<br /><span>All yours.</span></h2><p>Bring your notes, speeches and scripts together in a library that lives on your device. Import your documents. Arrange your sections. Make yourself at home.</p><div className="file-types"><span>TXT</span><span>DOCX</span><span>RTF</span><span>PDF</span></div><Link href="/guide/scripts" className="text-link">Meet your library <ArrowUpRight size={17} /></Link></div><div className="library-image" data-parallax="-0.035"><div className="image-label"><span className="status-dot" /> THE QUICKQUE LIBRARY · BROWSER PREVIEW</div><img src={`${config?.basePath ?? '/website/'}images/library.webp`} width="1360" height="900" alt="Quickque’s script library and section editor" loading="lazy" /></div></section>
    <section className="faq-section section-space"><div className="site-container faq-grid"><div><span className="eyebrow dark-eyebrow">A FEW THINGS TO KNOW</span><h2>Good questions.<br /><span>Clear answers.</span></h2><Link href="/guide" className="text-link">The full manual <ArrowUpRight size={16} /></Link></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={18} /></summary><p>{answer}</p></details>)}</div></div></section>
    <section className="closing-section"><div className="closing-grid" aria-hidden="true" /><div className="site-container closing-content"><span className="eyebrow dark-eyebrow"><Sparkles size={14} /> MAKE ROOM FOR YOUR NEXT MOMENT</span><h2>You’ve got something to say.<br /><span>Make it yours.</span></h2><div className="hero-actions"><Link href="/pricing" className="premium-button button-dark">Explore Quickque <ArrowUpRight size={18} /></Link><Link href="/install" className="text-link">Build from source <ArrowRight size={17} /></Link></div><p className="closing-price">{config?.commerce?.displayPrice ?? '£77'} planned one-time Mac purchase · MIT source available</p>{config?.release?.status === 'unavailable' && <p className="release-note">Prebuilt release currently unavailable. Build from source today.<br />Mac installer and physical-device verification are still outstanding.</p>}</div></section>
    {config?.sourceCommand && <section className="source-section site-container"><details><summary><span><Command size={18} /> Prefer to make it your own?</span><span>Build from source <Plus size={17} /></span></summary><div className="source-content"><TerminalInstall command={config.sourceCommand} /><p>Mac source builds need macOS 14+, Apple Silicon, Xcode 16+, stable Rust, Node.js 24, and pnpm 10.26.1. <Link href="/install">Read the setup steps.</Link></p></div></details></section>}
  </div>;
}
