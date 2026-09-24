import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VALT",
  description: "Next.js + FastAPI monorepo",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
