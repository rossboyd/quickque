import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Check, ChevronRight, Command, Layers3, LockKeyhole, Maximize2, Mic, Monitor, Pause, Play, Plus, Smartphone, Sparkles } from 'lucide-react';
import { Meta } from '../components/Meta';
import { FlowMesh } from '../components/FlowMesh';
import { TerminalInstall } from '../components/TerminalInstall';
import { DownloadGate } from '../components/DownloadGate';
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
      <div className="preview-sidebar"><span className="micro-label">YOUR LIBRARY</span><div className="preview-script selected"><span><Layers3 size={14} />The next big idea</span><small>{mode === 'presentation' ? 'Presenting' : 'Rehearsing'}</small></div><div className="preview-script"><span><Layers3 size={14} />A little introduction</span><small>Presentation</small></div><div className="preview-library-note"><LockKeyhole size={12} /> Saved on your Mac</div></div>
      <div className="preview-reader">
        <div className="preview-mode" role="group" aria-label="Explore a product mode">
          {(['presentation', 'performance'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setStep(0); }}>{value === 'presentation' ? 'Presenting' : 'Rehearsing'}</button>)}
        </div>
        <div className="preview-readout"><span className="micro-label">{mode === 'presentation' ? 'FIND YOUR FLOW' : step % 2 ? 'ALEX · YOUR TURN' : 'JAMIE · PARTNER LINE'}</span><p key={`${mode}-${step}`}>{lines[step]}</p><span className="preview-next-line">{lines[(step + 1) % lines.length]}</span></div>
        <div className="preview-transport"><span><i />{mode === 'presentation' ? 'Your pace. Your words.' : 'A scene partner. On your Mac.'}</span><button aria-label="Next demo line" onClick={() => setStep((step + 1) % lines.length)}><span>Next line</span><ChevronRight size={17} /></button></div>
      </div>
    </div>
    <div className="preview-caption">Interactive product illustration · no microphone or recording</div>
  </div>;
}

const features = [
  { icon: Monitor, title: 'Stay close to the camera.', text: 'Put a small, transparent script window beside your camera. Read your notes while keeping the call in view.', link: 'mac-overlay', label: 'Explore compact mode' },
  { icon: AudioLines, title: 'Scroll as you speak.', text: 'Voice Follow listens on your Mac and scrolls as you read. It supports English on macOS Tahoe 26+. Use Pause when you need to step away from the script.', link: 'local-flow', label: 'How Voice Follow works' },
  { icon: Smartphone, title: 'Your phone. Your remote.', text: 'Keep your Mac in position and advance the script from your phone. Pair them on the same trusted local network.', link: 'phone-remote', label: 'See remote setup' },
];
const questions = [
  ['What do I need to run Quickque?', 'An Apple Silicon Mac running macOS 26 or newer. The current test DMG is unsigned, and the install guide explains both the download and the source-build path.'],
  ['Do my scripts or voice go to the cloud?', 'No. Your scripts, voice samples and generated speech stay on your Mac. Voice features need an initial model download, then process audio locally. You don’t need an account to write, present or rehearse.'],
  ['Can I use it for a self-tape?', 'Scene Partner reads the other characters’ lines so you can practise your part. Use a separate phone or camera to record the take. Mac audio is still being tested, so try the setup before relying on it for a session.'],
  ['Can I bring my existing scripts?', 'Yes. Import TXT, DOCX, RTF, and text-based PDFs. Quickque extracts the text locally; scanned PDFs need OCR elsewhere first.'],
  ['Is it a subscription?', 'You can use Quickque for free. Pro will offer monthly or lifetime access for unlimited Voice Follow and AI voice playback. Lifetime includes one year of updates, then you keep the versions covered by your purchase. Paid plans aren’t available yet.'],
];

export function HomePage({ context }: { context?: any }) {
  const { config: rawConfig } = useSiteConfig();
  const config = rawConfig
    ? { ...rawConfig, basePath: `${rawConfig.basePath.replace(/\/+$/, '')}/` }
    : rawConfig;
  // Browser and Node math libraries can differ in the last decimal places.
  // Quantize the decorative waveform so its SSR style attributes hydrate exactly.
  const Math = {
    abs: globalThis.Math.abs,
    max: globalThis.Math.max,
    min: globalThis.Math.min,
    sin: (value: number) => Number(globalThis.Math.sin(value).toFixed(6)),
  };
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
    <Meta title="A teleprompter for your Mac" description="Keep your script beside the camera. Present at your own pace. Rehearse with a scene partner. Quickque keeps scripts and voice processing on your Mac." context={context} />
    <section className="premium-hero">
      <div className="hero-grid" aria-hidden="true" /><FlowMesh paused={motionPaused} /><div className="hero-halo" aria-hidden="true" />
      <div className="hero-content site-container">
        <div className="eyebrow"><span className="status-dot" /> A TELEPROMPTER FOR YOUR MAC</div>
        <h1>Keep your place.<br /><span>Sound like yourself.</span></h1>
        <p className="hero-description">Keep your script in view for a talk, a video call or a rehearsal.<br className="desktop-break" /> Quickque handles the prompting. Your words and voice stay on your Mac.</p>
         <div className="hero-actions"><Link href="/pricing" className="premium-button button-light">See plans <ArrowUpRight size={18} /></Link><a href={config?.demoUrl} className="premium-button button-ghost">Open the live demo <ArrowUpRight size={16} /></a></div>
        <div className="hero-footnote"><span className="hero-platform"><Command size={13} /> Apple Silicon · macOS 26+</span><span className="hero-footnote-divider" /><span>Free to start. No account needed. Test DMG available.</span></div>
      </div>
      <div className="hero-bottom site-container"><span>YOUR SCRIPT. YOUR PACE. YOUR MAC.</span><button className="motion-toggle" aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? <Play size={12} /> : <Pause size={12} />}{motionPaused ? 'Resume motion' : 'Pause motion'}</button></div>
    </section>
    <div className="principles-strip"><div className="site-container"><span><Monitor size={16} /> Made for Mac</span><span><LockKeyhole size={16} /> Scripts stored locally</span><span><Layers3 size={16} /> Voice processing on your Mac</span><span><Command size={16} /> No cloud AI required</span></div></div>
    <section className="use-cases-section site-container section-space"><div className="section-heading"><div><span className="eyebrow dark-eyebrow">01 / PRESENTATIONS AND REHEARSALS</span><h2>Give the talk.<br /><span>Practise the part.</span></h2></div><p>A speech and a scene need different kinds of prompting. Quickque gives you a place for both.</p></div><div className="use-case-grid"><article className="use-case-card presenting"><span>01 / PRESENTING</span><h3>Your notes, beside the camera.</h3><p>Keep your place through a long presentation. Scroll by hand, set a steady speed or let Voice Follow move the script as you speak.</p><small><LockKeyhole size={13} /> Voice following runs on your Mac</small></article><article className="use-case-card rehearsing"><span>02 / REHEARSING</span><h3>Someone to read the other lines.</h3><p>Choose your character and give the other parts a voice. Scene Partner reads their lines while you practise yours, with speech generated on your Mac.</p><small><LockKeyhole size={13} /> No cloud AI required</small></article></div></section>
    <section id="in-action" className="product-section site-container section-space">
      <div className="section-heading"><div><span className="eyebrow dark-eyebrow">02 / PRESENTING</span><h2>Keep your notes.<br /><span>Lose the paper shuffle.</span></h2></div><p>Import a script, split it into sections and open the reader. Adjust the text size and pace until it feels comfortable.</p></div>
      <div className="product-stage"><div className="stage-grid" aria-hidden="true" /><ProductPreview /><div className="floating-note" data-parallax="0.05"><span className="note-icon"><Check size={18} /></span><span>Saved on your Mac.<small>Your script library stays with you.</small></span></div></div>
      <div className="product-subline"><span>Try the illustration above. Switch modes and step through a few lines.</span><Link href="/guide">Read the manual <ArrowUpRight size={16} /></Link></div>
    </section>
    <section className="feature-section section-space"><div className="site-container"><div className="section-heading"><div><span className="eyebrow dark-eyebrow">03 / A FEW USEFUL CONTROLS</span><h2>Set it up.<br /><span>Make it comfortable.</span></h2></div><p>Move the script closer to the camera. Let it follow your voice. Or use your phone to turn the page.</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, text, link, label }, index) => <article className="premium-feature" key={title}><div className="feature-topline"><Icon size={22} strokeWidth={1.4} /><span>0{index + 1}</span></div><div className={`feature-art feature-art-${index}`} aria-hidden="true">{index === 0 ? <><div className="mini-window"><span /><span /><span /></div><div className="mini-overlay">Here’s the thing.<br /><strong>You’ve got this.</strong></div></> : index === 1 ? <div className="waveform">{Array.from({length:29}, (_, i) => <i key={i} style={{height:`${12 + Math.abs(Math.sin(i * 1.9)) * 48}px`}} />)}</div> : <div className="mini-phone"><span /><div><ChevronRight size={28} /></div><small>YOU’RE IN CONTROL</small></div>}</div><h3>{title}</h3><p>{text}</p><Link href={`/guide/${link}`}>{label}<ArrowUpRight size={16} /></Link></article>)}</div></div></section>
    <section className="performance-section"><div className="site-container performance-grid"><div className="performance-copy"><span className="eyebrow">04 / REHEARSING</span><h2>Run the scene.<br /><span>Then run it again.</span></h2><p>You don’t always have someone free to read with you. Assign voices to the other characters and work through the scene as often as you need.</p><Link href="/guide" className="premium-button button-light">Read the rehearsal guide <ArrowUpRight size={17} /></Link></div><div className="scene-stack" data-parallax="-0.055"><div className="scene-card scene-partner"><div><span className="role-orb"><AudioLines size={16} /></span><span>JAMIE<small>Scene partner</small></span><span className="scene-tag">PARTNER LINE</span></div><p>“I thought you might<br />come back.”</p></div><div className="scene-card scene-you"><div><span className="role-orb"><Mic size={16} /></span><span>ALEX<small>You’re playing this role</small></span><span className="scene-tag">YOUR TURN</span></div><p>“Some things are worth<br />a second chance.”</p><div className="scene-card-footer"><span className="status-dot" /> TAKE YOUR TIME. THIS IS YOUR LINE.</div></div><p className="scene-disclaimer">Scene Partner illustration. Record on a separate camera.<br />Voice samples are saved separately from your take.</p></div></div></section>
    <section className="library-section site-container section-space"><div className="library-copy"><span className="eyebrow dark-eyebrow">05 / PRIVATE BY DESIGN</span><h2>A home for<br /><span>your scripts.</span></h2><p>Import the documents you already have. Edit the words, arrange the sections and keep everything in a local library. Export a script backup when you need a copy.</p><div className="file-types"><span>TXT</span><span>DOCX</span><span>RTF</span><span>PDF</span></div><Link href="/guide/scripts" className="text-link">See how scripts are saved <ArrowUpRight size={17} /></Link></div><div className="library-image" data-parallax="-0.035"><div className="image-label"><span className="status-dot" /> THE QUICKQUE LIBRARY · BROWSER PREVIEW</div><img src={`${config?.basePath ?? '/'}images/library.webp`} width="1360" height="900" alt="Quickque’s script library and section editor" loading="lazy" /></div></section>
    <section className="faq-section section-space"><div className="site-container faq-grid"><div><span className="eyebrow dark-eyebrow">A FEW THINGS TO KNOW</span><h2>Before you start.</h2><Link href="/guide" className="text-link">The full manual <ArrowUpRight size={16} /></Link></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={18} /></summary><p>{answer}</p></details>)}</div></div></section>
    <section className="closing-section"><div className="closing-grid" aria-hidden="true" /><div className="site-container closing-content"><span className="eyebrow dark-eyebrow"><Sparkles size={14} /> START WITH A SCRIPT YOU KNOW</span><h2>Open your script.<br /><span>Give it a read.</span></h2><div className="hero-actions"><Link href="/pricing" className="premium-button button-dark">Compare plans <ArrowUpRight size={18} /></Link><Link href="/install" className="text-link">Install Quickque <ArrowRight size={17} /></Link></div><p className="closing-price">Free to use · Pro planned at {config?.commerce?.monthlyDisplayPrice}/month or {config?.commerce?.displayPrice} lifetime</p><p className="release-note">The current Mac download is an unsigned test build. Voice features are still being tested on Mac.</p></div></section>
    <div className="site-container download-section"><DownloadGate compact /></div>
    {config?.sourceCommand && <section className="source-section site-container"><details><summary><span><Command size={18} /> The source is available, too.</span><span>Build from source <Plus size={17} /></span></summary><div className="source-content"><TerminalInstall command={config.sourceCommand} /><p>Mac source builds need macOS 26+, Apple Silicon, Xcode 26 / Swift 6.2, stable Rust, Node.js 24, and pnpm 10.26.1. <Link href="/install">Read the setup steps.</Link></p></div></details></section>}
  </div>;
}
