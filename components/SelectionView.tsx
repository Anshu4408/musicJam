'use client';

import React, { useState } from 'react';

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
          <button className="btn-primary" disabled={isLoading}>Start Hosting</button>
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
            style={{ width: '100%', marginTop: '16px' }}
            disabled={isLoading || code.length !== 6}
          >
            Join Now
          </button>
        </form>
      </div>
    </section>
  );
}
