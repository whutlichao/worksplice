import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Hanken_Grotesk, Space_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import "katex/dist/katex.min.css";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-hanken-grotesk",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "worksplice",
  description: "worksplice — local workspace for collaborating with persistent pi coding agents",
  applicationName: "worksplice",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "worksplice",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#fffaef",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      translate="no"
      className={`${spaceGrotesk.variable} ${hankenGrotesk.variable} ${spaceMono.variable} notranslate`}
      suppressHydrationWarning
    >
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body translate="no" className="notranslate">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
