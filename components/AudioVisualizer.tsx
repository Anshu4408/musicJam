'use client';

import React, { useEffect, useRef } from 'react';
import { AppMode } from '@/hooks/useAudioEngine';
import { COLORS } from '@/lib/colors';

interface AudioVisualizerProps {
  analyserNode: AnalyserNode | null;
  mode:         AppMode;
  accentColor:  string;
}

export default function AudioVisualizer({
  analyserNode,
  mode,
  accentColor,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);
  const fakePhaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const BAR_COUNT = 48;
    const GAP       = 3;

    function draw() {
      if (!canvas || !ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barW = (W - GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      let amplitudes: Float32Array | number[];

      if (analyserNode) {
        const dataArr = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(dataArr);

        // Map bins to BAR_COUNT bars
        const step = Math.floor(dataArr.length / BAR_COUNT);
        amplitudes = Array.from({ length: BAR_COUNT }, (_, i) => {
          const slice = dataArr.slice(i * step, (i + 1) * step);
          return slice.reduce((s, v) => s + v, 0) / (slice.length || 1) / 255;
        });
      } else {
        // Client mode: generate a fake animated waveform
        fakePhaseRef.current += 0.07;
        amplitudes = Array.from({ length: BAR_COUNT }, (_, i) => {
          const t = fakePhaseRef.current;
          return (
            0.3 +
            0.3 * Math.sin(i * 0.4 + t) +
            0.2 * Math.sin(i * 0.15 + t * 1.3) +
            0.1 * Math.random()
          );
        });
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const amp = Math.max(0.04, (amplitudes as number[])[i] as number);
        const barH = amp * H * 0.85;
        const x  = i * (barW + GAP);
        const y  = (H - barH) / 2;

        // Gradient per bar
        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0,   accentColor + 'ff');
        grad.addColorStop(0.5, accentColor + 'aa');
        grad.addColorStop(1,   accentColor + '44');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyserNode, accentColor]);

  // Handle resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      if (canvas.parentElement) {
        canvas.width  = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      }
    });
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="visualizer-wrapper">
      <canvas ref={canvasRef} className="visualizer-canvas" />
    </div>
  );
}
