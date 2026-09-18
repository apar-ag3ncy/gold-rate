import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chheda Rate – Staff share', manifest: '/manifest.webmanifest' };
// The service worker file lives at /sw.js but is registered with scope /staff/ (see page.tsx); Next serves it with
// Service-Worker-Allowed defaulting to its own path, which already permits the narrower /staff/ scope.

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">{children}</div>;
}
