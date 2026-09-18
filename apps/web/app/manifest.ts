import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chheda Jewellers – Gold Rate Share',
    short_name: 'Chheda Rate',
    description: 'Share today’s gold rate to the Instagram Broadcast Channel, WhatsApp Channel and Community with one tap.',
    start_url: '/staff',
    scope: '/',
    display: 'standalone',
    background_color: '#0b3a2d',
    theme_color: '#0b3a2d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
