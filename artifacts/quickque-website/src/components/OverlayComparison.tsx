import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

export function OverlayComparison() {
  const [sliderPosition, setSliderPosition] = useState(50);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSliderPosition(Number(e.target.value));
  };

  return (
    <div className="overlay-comparison-section section-space">
      <div className="site-container">
        <div className="section-heading">
          <div>
            <span className="eyebrow dark-eyebrow">02 / COMPACT MODE</span>
            <h2>
              Stay on script.<br />
              <span>Keep your eyes on the call.</span>
            </h2>
          </div>
          <p>Read your notes while keeping your audience in view. Quickque sits neatly beside your camera, letting you maintain eye contact effortlessly.</p>
        </div>

        <div className="comparison-container" style={{ '--position': `${sliderPosition}%` } as React.CSSProperties}>
          <div className="comparison-before">
            <div className="comparison-label">WITHOUT QUICKQUE</div>
            <div className="mock-screen">
              <div className="mock-call-grid mock-call-grid-full">
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
              </div>
              <div className="mock-document-window">
                <div className="mock-window-header"><span /><span /><span /> Notes.docx</div>
                <div className="mock-document-content">
                  <p className="mock-title">The Big Idea</p>
                  <div className="mock-line" />
                  <div className="mock-line" />
                  <div className="mock-line" style={{ width: '80%' }}/>
                  <div className="mock-line" />
                  <div className="mock-line" style={{ width: '60%' }}/>
                </div>
              </div>
            </div>
          </div>
          
          <div className="comparison-after" style={{ clipPath: `polygon(0 0, var(--position) 0, var(--position) 100%, 0 100%)` }}>
            <div className="comparison-label">WITH QUICKQUE</div>
            <div className="mock-screen">
              <div className="mock-call-grid mock-call-grid-full">
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
                <div className="mock-participant"><div className="mock-avatar" /></div>
              </div>
              
              <div className="mock-quickque-overlay">
                 <div className="preview-windowbar"><span className="window-dots"><i /><i /><i /></span><span>Quickque</span></div>
                 <div className="mock-quickque-content">
                    <p>The Big Idea</p>
                    <p className="mock-quickque-muted">Read your notes while keeping your audience in view. Quickque sits neatly beside your camera.</p>
                 </div>
              </div>
            </div>
          </div>

          <div className="comparison-track" />
          <input
            type="range"
            min="0"
            max="100"
            value={sliderPosition}
            onChange={handleChange}
            className="comparison-slider"
            aria-label="Drag to compare screen without and with Quickque overlay"
            title="Drag to compare screen without and with Quickque overlay"
          />
        </div>
        <div className="preview-caption">Illustrative preview · representative layout</div>

        <div className="comparison-footer">
          <p className="text-sm text-[var(--text-muted)]">Note: Screen sharing may capture the transparent overlay. The manual advises on sharing specific windows rather than your full display.</p>
          <Link href="/guide/mac-overlay" className="text-link">Read the overlay guide <ArrowRight size={16} /></Link>
        </div>
      </div>
    </div>
  );
}