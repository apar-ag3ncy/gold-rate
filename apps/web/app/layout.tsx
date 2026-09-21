import type { Metadata } from 'next';
import { Cormorant, Montserrat } from 'next/font/google';
import './globals.css';

// Same type pairing as chhedajewellers.com: Cormorant for headings, Montserrat for UI.
const cormorant = Cormorant({ subsets: ['latin'], weight: ['300', '400', '500', '600'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' });
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-montserrat', display: 'swap' });

export const metadata: Metadata = {
  title: 'Chheda Gold Rate Admin', robots: { index: false, follow: false },
};
export const viewport = { themeColor: '#0b3a2d', width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${cormorant.variable} ${montserrat.variable}`}><body>{children}</body></html>;
}
