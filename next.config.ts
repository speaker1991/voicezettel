import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
    dest: "public",
    register: true,
    disable: process.env.NODE_ENV === "development",
    // REMOVED: cacheOnFrontEndNav and aggressiveFrontEndNavCaching
    // These caused users to see stale JS after deployments.
    // Next.js built-in caching with hashed filenames is sufficient.
    fallbacks: {
        document: "/offline",
    },
});

const nextConfig: NextConfig = {
    devIndicators: false,
    turbopack: {},
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "lh3.googleusercontent.com",
            },
        ],
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    {
                        key: "Permissions-Policy",
                        value: "microphone=(self), camera=(self)",
                    },
                ],
            },
        ];
    },
};

export default withPWA(nextConfig);
