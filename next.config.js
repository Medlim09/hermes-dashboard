/** @type {import('next').NextConfig} */
const FLASK = process.env.HERMES_API_URL || 'http://localhost:8787'

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${FLASK}/:path*` },
    ]
  },
}
module.exports = nextConfig
