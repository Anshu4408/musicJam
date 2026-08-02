'use client';

import React from 'react';
import Header from '@/components/Header';
import SelectionView from '@/components/SelectionView';
import ActiveView from '@/components/ActiveView';
import ErrorBanner from '@/components/ErrorBanner';
import { useAudioEngine } from '@/hooks/useAudioEngine';

export default function Home() {
  const {
    mode, isLoading, error, stats, connectedClients, analyserNode,
    roomCode, startHost, startClient, stop,
  } = useAudioEngine();

  return (
    <div className="app-shell">
      {/* Ambient background orbs */}
      <div className="orb orb-1" aria-hidden="true" />
      <div className="orb orb-2" aria-hidden="true" />
      <div className="orb orb-3" aria-hidden="true" />

      {/* Noise texture overlay */}
      <div className="noise-overlay" aria-hidden="true" />

      <div className="container">
        <Header mode={mode} />

        <main className="main-content">
          {mode !== 'idle' ? (
            <ActiveView
              mode={mode}
              stats={stats}
              connectedClients={connectedClients}
              analyserNode={analyserNode}
              isLoading={isLoading}
              roomCode={roomCode}
              onStop={stop}
            />
          ) : (
            <SelectionView
              onStartHost={startHost}
              onStartClient={startClient}
              isLoading={isLoading}
            />
          )}

          {error && <ErrorBanner message={error} />}
        </main>

        <footer className="footer" role="contentinfo">
          WebRTC · Opus 48kHz · PeerJS · Real-time
        </footer>
      </div>
    </div>
  );
}
