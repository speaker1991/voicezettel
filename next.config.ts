import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
    dest: "public",
    register: true,
    disable: process.env.NODE_ENV === "development",
    cacheOnFrontEndNav: true,
    aggressiveFrontEndNavCaching: true,
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
