import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prode San Martín",
  description: "Group stage prediction game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
