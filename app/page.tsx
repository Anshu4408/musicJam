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
    roomCode, needsGesture, trackName, downloadProgress, isPlaying, libraryTracks,
    uploadFile, loadFromLibrary, deleteFromLibrary, broadcastPlay, broadcastPause,
    startHost, startClient, stop, resumeAudio,
    broadcastSeek, getPlaybackPosition, trackDuration
  } = useAudioEngine();

  return (
    <>
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
            needsGesture={needsGesture}
            trackName={trackName}
            trackDuration={trackDuration}
            getPlaybackPosition={getPlaybackPosition}
            downloadProgress={downloadProgress}
            isPlaying={isPlaying}
            libraryTracks={libraryTracks}
            onUploadFile={uploadFile}
            onLoadFromLibrary={loadFromLibrary}
            onDeleteFromLibrary={deleteFromLibrary}
            onBroadcastPlay={broadcastPlay}
            onBroadcastPause={broadcastPause}
            onBroadcastSeek={broadcastSeek}
            onStop={stop}
            onResumeAudio={resumeAudio}
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

      <footer className="footer" role="contentinfo" style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
        MusicJAM · Sonic Ethereal UI · V2
      </footer>
    </>
  );
}
