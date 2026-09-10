const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*`}];
  },
};

export default nextConfig;
