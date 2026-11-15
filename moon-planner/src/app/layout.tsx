import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import Navbar from "@/components/Navbar";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lunar Landing Site Navigator",
  description:
    "Compare the south-pole regions NASA named for Artemis III in 2024 by when the Sun and Earth clear the real terrain horizon.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Navbar />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
