import type { NextConfig } from "next";
const managedWebApp = process.env.FIREBASE_WEBAPP_CONFIG ? JSON.parse(process.env.FIREBASE_WEBAPP_CONFIG) : {};

const config: NextConfig = {
  distDir: process.env.QUOTEFORGE_NEXT_DIST || ".next",
  devIndicators: false,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || managedWebApp.apiKey || "",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || managedWebApp.authDomain || "",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || managedWebApp.projectId || "",
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || managedWebApp.appId || "",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || managedWebApp.storageBucket || ""
  },
  outputFileTracingExcludes: {"/*": ["./reference-source/**/*", "./tests/**/*", "./artifacts/**/*", "./.tools/**/*", "./.runtime/**/*", "./.env*", "./**/*.log", "./docs/**/*"]},
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" }
    ] }];
  }
};
export default config;
