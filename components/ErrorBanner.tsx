'use client';

import React from 'react';

interface ErrorBannerProps {
  message: string;
}

export default function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__icon">⚠️</span>
      <span className="error-banner__text">{message}</span>
    </div>
  );
}
