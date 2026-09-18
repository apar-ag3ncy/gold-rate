import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chheda Rate – Staff share', manifest: '/manifest.webmanifest' };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">{children}</div>;
}
