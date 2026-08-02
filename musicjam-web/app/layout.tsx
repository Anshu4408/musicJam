import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-outfit',
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
    <html lang="en" className={outfit.variable}>
      <body>{children}</body>
    </html>
  );
}
