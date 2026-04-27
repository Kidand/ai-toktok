import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { StoreHydrator } from "@/components/StoreHydrator";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-noto-serif-sc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI TokTok · 沉浸式互动叙事沙盒",
  description: "穿越进入任意故事世界，与角色实时互动，产生个性化分支剧情",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#f5efe0',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased ${spaceGrotesk.variable} ${jetBrainsMono.variable} ${notoSerifSC.variable}`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: `var(--font-space-grotesk), 'Space Grotesk', 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
        }}
      >
        <StoreHydrator />
        {children}
      </body>
    </html>
  );
}
