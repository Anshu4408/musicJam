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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
      </head>
      <body>{children}</body>
    </html>
  );
}
