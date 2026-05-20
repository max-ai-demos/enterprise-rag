// apps/web/next.config.mjs
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    serverActions: { bodySizeLimit: '50mb' },
  },
  webpack: (config, { isServer }) => {
    // canvas stub to avoid pdfjs-dist pulling in node-canvas on the client
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
      }
    }
    return config
  },
}

export default nextConfig
