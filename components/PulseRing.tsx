'use client';

import React, { useEffect, useRef } from 'react';

interface PulseRingProps {
  color: string;
  active: boolean;
}

export default function PulseRing({ color, active }: PulseRingProps) {
  if (!active) return null;
  return (
    <>
      <span className="pulse-ring pulse-ring-1" style={{ borderColor: color }} />
      <span className="pulse-ring pulse-ring-2" style={{ borderColor: color }} />
    </>
  );
}
