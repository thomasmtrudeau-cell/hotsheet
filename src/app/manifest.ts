import type { MetadataRoute } from 'next';

// Web app manifest — lets Hot Sheet install to a home screen (required for iOS
// push) and gives it a standalone app shell.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hot Sheet',
    short_name: 'Hot Sheet',
    description: 'Follow your players — call-ups, IL moves, and hot streaks.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#ea580c',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
