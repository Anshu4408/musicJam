'use client';

import React, { useState } from 'react';
import { Zap, Music, Lock, Loader2 } from 'lucide-react';

interface SelectionViewProps {
  onStartHost:   () => void;
  onStartClient: (code: string) => void;
  isLoading:     boolean;
}

export default function SelectionView({ onStartHost, onStartClient, isLoading }: SelectionViewProps) {
  const [code, setCode] = useState('');

  return (
    <section className="selection-view">
      <h1>MusicJAM</h1>
      <p>Zero-lag synchronized audio streaming. Listen together perfectly.</p>

      <div className="action-stack">
        <div className="action-card" onClick={isLoading ? undefined : onStartHost}>
          <h3>Host a Party</h3>
          <p>Create a room and stream your library in perfect sync.</p>
          <button className="btn-primary" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isLoading && <Loader2 size={18} className="spin" />}
            {isLoading ? 'Starting...' : 'Start Hosting'}
          </button>
        </div>

        <form className="action-card" onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6 && !isLoading) onStartClient(code);
        }}>
          <h3>Join a Party</h3>
          <p>Enter a 6-letter code to listen in.</p>
          <input
            className="join-input"
            type="text"
            placeholder="ENTER CODE"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={isLoading}
          />
          <button 
            type="submit"
            className="btn-primary" 
            style={{ width: '100%', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            disabled={isLoading || code.length !== 6}
          >
            {isLoading && <Loader2 size={18} className="spin" />}
            {isLoading ? 'Joining...' : 'Join Now'}
          </button>
        </form>
      </div>

      <div className="how-it-works-section">
        <h3 className="how-it-works-title">How it Works</h3>
        <div className="how-it-works-grid">
          <div className="how-it-works-card">
            <div className="how-it-works-icon"><Zap size={32} /></div>
            <h4>Zero-Lag Sync</h4>
            <p>Powered by UDP Multicast and NTP Clock Synchronization for frame-perfect playback.</p>
          </div>
          <div className="how-it-works-card">
            <div className="how-it-works-icon"><Music size={32} /></div>
            <h4>High Fidelity</h4>
            <p>Streams raw audio via Opus 48kHz encoding, preserving your track's original master quality.</p>
          </div>
          <div className="how-it-works-card">
            <div className="how-it-works-icon"><Lock size={32} /></div>
            <h4>Peer-to-Peer</h4>
            <p>Music is streamed directly between devices on the same network. No cloud servers required.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
