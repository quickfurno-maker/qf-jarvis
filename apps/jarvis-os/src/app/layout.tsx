import type { Metadata, Viewport } from 'next';

import { AppShell } from '@/components/shell/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jarvis OS — Control Plane',
  description:
    'Operator control plane for QF Jarvis. A powerless read surface: QuickFurno Core authorizes, n8n executes, providers deliver.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // `width=device-width` is not optional. Without it a mobile browser lays the page out at a
  // ~980px viewport and then scales it down, so every responsive breakpoint resolves as though
  // the screen were a small desktop -- which is exactly the horizontal overflow it looks like.
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06080d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
