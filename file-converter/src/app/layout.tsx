import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const bodyFont = Noto_Sans_KR({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const monoFont = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Format Foundry",
  description: "PDF, PNG, JPG, WEBP browser-side converter for Vercel deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${bodyFont.variable} ${monoFont.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
