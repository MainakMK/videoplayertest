import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Player Dashboard",
  description: "Manage your video content, analytics, and settings",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
