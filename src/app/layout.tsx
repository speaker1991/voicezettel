import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DevOverlaySuppressor } from "@/components/layout/DevOverlaySuppressor";
import { ChangelogNotifier } from "@/components/layout/ChangelogNotifier";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VoiceZettel",
  description: "Voice-first Zettelkasten with AI",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          // Force SW update + cache clear (v2 — 2026-03-16)
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(registrations) {
              for (var reg of registrations) { reg.update(); }
            });
            if ('caches' in window) {
              caches.keys().then(function(names) {
                for (var name of names) { caches.delete(name); }
              });
            }
          }
        `}} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
        <DevOverlaySuppressor />
        <ChangelogNotifier />
      </body>
    </html>
  );
}
