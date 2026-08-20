import type { Metadata, Viewport } from 'next';
import { BUSINESS } from '@/lib/config';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: `${BUSINESS.name} — Operations`,
  description:
    'Live car wash operations: vehicle queue, worker assignment, cleaning timers and daily performance.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1D6E96',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Closes the `html.js` gate before first paint, so the motion layer
            never flashes content in and out on hydration — and so a browser
            without JavaScript renders everything visible instead of hidden. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
