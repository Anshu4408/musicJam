import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});


export const metadata: Metadata = {
  title: 'MusicJAM — Zero-lag synchronized audio streaming',
  description:
    'Stream audio in perfect sync across multiple devices on the same network. ' +
    'Powered by Opus encoding, UDP multicast, and NTP clock synchronization.',
  keywords: ['audio streaming', 'synchronized audio', 'music jam', 'opus', 'udp multicast'],
  openGraph: {
    title: 'MusicJAM',
    description: 'Zero-lag synchronized audio streaming across all your devices',
    type: 'website',
  },
};

export const viewport: import('next').Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head />
      <body>
        <div className="ambient-mesh"></div>
        <div className="app-shell">
          <main className="container">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
