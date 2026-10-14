import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['web-push'],
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: '24mb' },
  async headers() {
    return [{source:'/mail-push-sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Content-Security-Policy',value:"default-src 'none'; script-src 'self'"}]},{source: '/:path*', headers: [
      {key:'X-Content-Type-Options', value:'nosniff'},
      {key:'Referrer-Policy', value:'no-referrer'},
      {key:'X-Frame-Options', value:'DENY'},
      {key:'Permissions-Policy', value:'camera=(), microphone=(), geolocation=()'},
    ]}];
  },
};
export default config;
