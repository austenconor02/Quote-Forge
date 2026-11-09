import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./readability.css";
import "./brand.css";
import "./source-intake.css";
import "./owner-clean.css";
import "./company-wizard.css";
import "./owner-tutorial.css";
import "./document-processing.css";
import "./proposal-template.css";

export const metadata: Metadata = { title: "QuoteForge | My Companies", description: "Manage companies, branding, and quoting application access." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#112138" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
