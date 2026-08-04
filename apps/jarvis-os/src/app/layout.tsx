import type { Metadata, Viewport } from 'next';

import './globals.css';

/**
 * The root layout (JOS-01A; reduced to html/body in JOS-01C).
 *
 * It used to render `AppShell` around everything. It cannot any more: `/login` is reached by an
 * UNAUTHENTICATED visitor, and wrapping it in the operator shell would leak the navigation — every
 * module name, the agent roster, the boundary sections — to anyone who can load the page.
 *
 * So the shell moved down into `(protected)/layout.tsx`, which verifies a session before it
 * renders anything. This file now owns only the document: language, metadata and global styles.
 * Route groups mean the URLs are unchanged — `(protected)` and `(public)` are organisational and
 * never appear in a path.
 */
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
