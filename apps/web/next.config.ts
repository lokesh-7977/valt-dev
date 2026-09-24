import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@valt/shared"],
  async rewrites() {
    // Proxy browser calls to /api/py/* onto the FastAPI service.
    return [
      {
        source: "/api/py/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
