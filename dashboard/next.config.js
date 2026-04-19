/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

const nextConfig = {
  ...(isDev ? {} : { output: 'export' }),
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (!isDev) return [];
    const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';
    return [
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
      { source: '/cdn/:path*', destination: `${apiTarget}/cdn/:path*` },
    ];
  },
};

module.exports = nextConfig;
