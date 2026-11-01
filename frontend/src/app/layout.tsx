import type { Metadata, Viewport } from 'next';
import { SiteHeader } from '@/components/site-header';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Lahore Rides', template: '%s · Lahore Rides' },
  description: 'Book a ride between Lahore landmarks (ride-booking assessment demo).',
};

export const viewport: Viewport = {
  themeColor: '#047857',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <Providers>
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
