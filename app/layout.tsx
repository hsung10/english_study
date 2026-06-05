import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "English Shadowing Studio",
  description: "A clean frontend-only English shadowing study tool.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
