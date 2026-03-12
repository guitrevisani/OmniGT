// /src/app/layout.js
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import OneSignalInit from "@/components/OneSignalInit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: {
    default: "OmniGT",
    template: "OGT - %s",
  },
  description: "OGT Event Engine",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <meta name="robots" content="noindex,nofollow" />
      <link rel="icon" href="/favicon.png" />
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <OneSignalInit />
        {children}
      </body>
    </html>
  );
}
