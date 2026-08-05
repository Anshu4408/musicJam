'use client';

import React, { useState, useRef, useMemo } from 'react';
import { Search, Headphones, Music, Volume2, Pause, Play, Info, X, Trash2, Upload } from 'lucide-react';
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
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* ── SPOTIFY-STYLE TRACK HEADER ── */}
        <div className="active-track-banner" style={{ display: 'flex', alignItems: 'flex-end', gap: '24px', padding: '24px', background: 'linear-gradient(transparent 0%, rgba(0,0,0,0.5) 100%)', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '24px' }}>
          <div className="banner-art" style={{ width: '120px', height: '120px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            <Music size={48} color="var(--text-muted)" />
          </div>
          <div className="banner-info" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-primary)' }}>Now Playing</span>
            <h2 style={{ fontSize: 'clamp(28px, 6vw, 48px)', fontWeight: '800', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>{trackName || 'No track selected'}</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
              {downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : (trackName ? 'High-Fidelity Audio' : 'Waiting for host...')}
            </p>
          </div>
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
              <div className="search-box">
                <span className="search-icon"><Search size={18} /></span>
                <input 
                  className="join-input"
                  style={{ padding: '16px', fontSize: '16px', borderRadius: '999px', letterSpacing: 'normal', paddingLeft: '48px', width: '100%' }}
                  type="text" 
                  placeholder="Find in library" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="library-list">
              {filteredLibrary.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                  <p>No tracks found. Upload audio files to add them.</p>
                </div>
              ) : (
                filteredLibrary.map((t, index) => (
                  <div key={t} className={`track-row ${t === trackName ? 'active' : ''}`} onClick={() => onLoadFromLibrary(t)}>
                    <div className="track-left">
                      <div className="track-num-container">
                        <span className="track-num">{index + 1}</span>
                        <Play className="track-play-icon" size={14} fill="currentColor" />
                      </div>
                      <div className="track-art-placeholder">
                        <Music size={16} color="var(--text-muted)" />
                      </div>
                      <div className="track-details">
                        <div className="track-title">{t}</div>
                        <div className="track-artist">High-Fidelity Audio</div>
                      </div>
                    </div>
                    {trackToDelete === t ? (
                      <div className="track-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-confirm-delete" onClick={() => { onDeleteFromLibrary(t); setTrackToDelete(null); }}>Delete</button>
                        <button className="btn-cancel-delete" onClick={() => setTrackToDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="track-actions">
                        <button className="btn-delete-icon" onClick={(e) => { e.stopPropagation(); setTrackToDelete(t); }} title="Delete">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="library-container">
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px', fontSize: '20px', fontWeight: '700' }}>Cached on your device</h3>
            <div className="library-list">
              {libraryTracks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                  <p>No tracks cached yet.</p>
                </div>
              ) : (
                libraryTracks.map((t, index) => (
                  <div key={t} className={`track-row ${t === trackName ? 'active' : ''}`}>
                    <div className="track-left">
                      <div className="track-num-container">
                        <span className="track-num">{index + 1}</span>
                      </div>
                      <div className="track-art-placeholder">
                        <Music size={16} color="var(--text-muted)" />
                      </div>
                      <div className="track-details">
                        <div className="track-title">{t}</div>
                        <div className="track-artist">Available offline</div>
                      </div>
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
                <span style={{ display: 'flex', alignItems: 'center', color: 'white' }}>
                  {isPlaying ? <Volume2 size={24} /> : <Music size={24} />}
                </span>
              </div>
              <div>
                <div className="track-title-clamp" style={{ fontWeight: '600' }}>{trackName || 'No track selected'}</div>
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
                  {isPlaying ? <Pause size={24} /> : <Play size={24} />}
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
                <Info size={20} />
              </button>
              <button className="btn-icon-subtle" onClick={onStop} title="Leave Room" style={{ marginLeft: '12px', color: '#ff4444' }}>
                <X size={20} />
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
