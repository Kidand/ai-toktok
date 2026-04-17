import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI TokTok - \u6c89\u6d78\u5f0fIP\u4e92\u52a8\u53d9\u4e8b\u6c99\u76d2",
  description: "\u7a7f\u8d8a\u8fdb\u5165\u4efb\u610f\u6545\u4e8b\u4e16\u754c\uff0c\u4e0e\u89d2\u8272\u5b9e\u65f6\u4e92\u52a8\uff0c\u4ea7\u751f\u4e2a\u6027\u5316\u5206\u652f\u5267\u60c5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
