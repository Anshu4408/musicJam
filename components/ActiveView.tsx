'use client';

import React, { useState, useRef, useMemo } from 'react';
import StatsPanel from './StatsPanel';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';

interface ActiveViewProps {
  mode:                AppMode;
  stats:               EngineStats | null;
  connectedClients:    number;
  analyserNode:        AnalyserNode | null; // not used in minimal theme
  isLoading:           boolean;
  roomCode:            string;
  needsGesture:        boolean;
  trackName:           string | null;
  trackDuration:       number;
  getPlaybackPosition: () => number;
  downloadProgress:    number;
  isPlaying:           boolean;
  libraryTracks:       string[];
  onUploadFile:        (file: File) => void;
  onLoadFromLibrary:   (name: string) => void;
  onDeleteFromLibrary: (name: string) => void;
  onBroadcastPlay:     () => void;
  onBroadcastPause:    () => void;
  onBroadcastSeek:     (time: number) => void;
  onStop:              () => void;
  onResumeAudio:       () => void;
}

export default function ActiveView({
  mode,
  stats,
  connectedClients,
  isLoading,
  roomCode,
  needsGesture,
  trackName,
  trackDuration,
  getPlaybackPosition,
  downloadProgress,
  isPlaying,
  libraryTracks,
  onUploadFile,
  onLoadFromLibrary,
  onDeleteFromLibrary,
  onBroadcastPlay,
  onBroadcastPause,
  onBroadcastSeek,
  onStop,
  onResumeAudio,
}: ActiveViewProps) {
  const isHost = mode === 'host';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);

  // Refs for high-frequency progress bar updates without React re-renders
  const progressInputRef = useRef<HTMLInputElement>(null);
  const progressTimeRef = useRef<HTMLSpanElement>(null);
  const isDraggingRef = useRef(false);

  React.useEffect(() => {
    let rafId: number;
    const updateProgressUI = () => {
      if (!isDraggingRef.current && progressInputRef.current && progressTimeRef.current) {
        const pos = getPlaybackPosition();
        progressInputRef.current.value = pos.toString();
        progressTimeRef.current.innerText = formatTime(pos);
        
        // Fix for progress bar visual fill
        const percent = trackDuration ? (pos / trackDuration) * 100 : 0;
        progressInputRef.current.style.backgroundSize = `${percent}% 100%`;
      }
      rafId = requestAnimationFrame(updateProgressUI);
    };
    rafId = requestAnimationFrame(updateProgressUI);
    return () => cancelAnimationFrame(rafId);
  }, [getPlaybackPosition, trackDuration]);

  const filteredLibrary = useMemo(() => {
    return libraryTracks.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [libraryTracks, searchQuery]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const stringToHue = (str: string | null) => {
    if (!str) return 260;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 360);
  };

  return (
    <section className="active-view">
      {/* Mobile Audio Unlock Overlay */}
      {needsGesture && (
        <div className="gesture-overlay">
          <div className="gesture-modal">
            <h2>Playback Paused</h2>
            <p>Tap below to instantly resync audio playback with the host.</p>
            <button className="btn-primary" onClick={onResumeAudio}>
              Resume Sync
            </button>
          </div>
        </div>
      )}

      {/* Main View Area (Library) */}
      <div className="view-header">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>{isHost ? 'Your Library' : 'Listening Party'}</h2>
        </div>
        {isHost && (
          <div className="room-details">
            <div className="room-code-badge">{roomCode}</div>
            <div className="listeners-badge">
              <div className="live-dot"></div>
              {connectedClients} {connectedClients === 1 ? 'Listener' : 'Listeners'}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Massive Now Playing Visual (3D Tilting) */}
        <div className="hero-art-container">
          <div 
            className={`hero-art ${isPlaying ? '' : 'paused'}`}
            style={trackName ? { backgroundImage: `linear-gradient(135deg, hsl(${stringToHue(trackName)}, 80%, 60%), hsl(${(stringToHue(trackName) + 40) % 360}, 80%, 40%))` } : undefined}
          >
            <div className="hero-art-icon">
              {isPlaying ? '🎧' : '🎵'}
            </div>
          </div>
        </div>

        <div className="track-info-large">
          <h2>{trackName || 'No track selected'}</h2>
          <p>
             {downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : (trackName ? 'High-Fidelity Audio' : 'Waiting for host...')}
          </p>
        </div>

        {isHost ? (
          <div className="library-container">
            <div className="library-toolbar">
              <button 
                className="btn-primary" 
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                {isLoading ? 'Uploading...' : 'Upload Music'}
              </button>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                ref={fileInputRef}
              />
              <input 
                className="join-input"
                style={{ padding: '16px', fontSize: '16px', borderRadius: '999px', letterSpacing: 'normal' }}
                type="text" 
                placeholder="Find in library" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredLibrary.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  <p>No tracks found. Upload audio files to add them to your library.</p>
                </div>
              ) : (
                filteredLibrary.map((t, index) => (
                  <div key={t} onClick={() => onLoadFromLibrary(t)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderRadius: '16px', background: t === trackName ? 'var(--bg-glass-light)' : 'transparent', border: t === trackName ? '1px solid var(--accent-primary)' : '1px solid transparent', cursor: 'pointer', transition: 'all 0.2s' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>0{index + 1}</div>
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{t}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>High-Fidelity Audio</div>
                      </div>
                    </div>
                    {trackToDelete === t ? (
                      <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => { onDeleteFromLibrary(t); setTrackToDelete(null); }}
                          style={{ padding: '8px 12px', borderRadius: '8px', background: '#ff4444', color: 'white', fontWeight: 'bold' }}
                        >
                          Confirm
                        </button>
                        <button 
                          onClick={() => setTrackToDelete(null)}
                          style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--bg-glass-heavy)', color: 'white' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setTrackToDelete(t); }}
                        style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Delete Track"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="library-container">
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px' }}>Cached on your device</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {libraryTracks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  <p>No tracks cached yet.</p>
                </div>
              ) : (
                libraryTracks.map((t, index) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', borderRadius: '16px', background: t === trackName ? 'var(--bg-glass-light)' : 'transparent', border: t === trackName ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>0{index + 1}</div>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>{t}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Available offline</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Player */}
      <div className="bottom-player-wrapper">
        <div className="glass-pill">
          <div className="player-main-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div 
                className="player-art"
                style={trackName ? { backgroundImage: `linear-gradient(135deg, hsl(${stringToHue(trackName)}, 80%, 60%), hsl(${(stringToHue(trackName) + 40) % 360}, 80%, 40%))` } : undefined}
              >
                <span style={{ fontSize: '24px' }}>
                  {isPlaying ? '🔊' : '🎵'}
                </span>
              </div>
              <div>
                <div style={{ fontWeight: '600' }}>{trackName || 'No track selected'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : (trackName ? 'High-Fidelity Sync' : '—')}
                </div>
              </div>
            </div>

            <div className="player-controls">
              {isHost ? (
                <button 
                  className="btn-circle" 
                  onClick={isPlaying ? onBroadcastPause : onBroadcastPlay}
                  disabled={!trackName || downloadProgress < 100}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  {isPlaying ? 'Synced' : 'Waiting'}
                </div>
              )}
            </div>

            <div className="player-right">
              {/* Info Button for Stats */}
              <button className="btn-icon-subtle" onClick={() => setShowStats(true)} title="View Diagnostics">
                ℹ️
              </button>
              <button className="btn-icon-subtle" onClick={onStop} title="Leave Room" style={{ marginLeft: '12px', color: '#ff4444' }}>
                ✕
              </button>
            </div>
          </div>

          <div className="player-progress-bar-wrapper">
            {downloadProgress < 100 && trackName ? (
              <div 
                className="player-progress-fill" 
                style={{ width: `${downloadProgress}%`, backgroundColor: 'var(--text-muted)' }} 
              />
            ) : (
              <div className="seek-bar-container">
                <span className="time-label" ref={progressTimeRef}>0:00</span>
                <input 
                  ref={progressInputRef}
                  type="range"
                  className="seek-slider"
                  min={0}
                  max={trackDuration || 100}
                  step={0.1}
                  defaultValue={0}
                  onPointerDown={() => { isDraggingRef.current = true; }}
                  onPointerUp={(e) => { 
                    isDraggingRef.current = false;
                    if (isHost && trackDuration) {
                      onBroadcastSeek(parseFloat(e.currentTarget.value));
                    }
                  }}
                  onChange={(e) => {
                    if (progressTimeRef.current) {
                      progressTimeRef.current.innerText = formatTime(parseFloat(e.target.value));
                    }
                  }}
                  disabled={!isHost || !trackName || downloadProgress < 100}
                />
                <span className="time-label">{formatTime(trackDuration)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Modal */}
      {showStats && (
        <StatsPanel 
          stats={stats} 
          mode={mode} 
          connectedClients={connectedClients} 
          onClose={() => setShowStats(false)} 
        />
      )}
    </section>
  );
}
