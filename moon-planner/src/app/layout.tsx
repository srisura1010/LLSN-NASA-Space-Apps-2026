import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import Navbar from "@/components/Navbar";
import { tokenCss } from "@/lib/tokens";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Artemis Assist",
  description:
    "Compare the south-pole regions NASA named for Artemis III in 2024 by when the Sun and Earth clear the real terrain horizon.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <head>
        {/* The colour tokens (src/lib/tokens.ts), which globals.css maps onto the Tailwind colour names. */}
        <style dangerouslySetInnerHTML={{ __html: tokenCss }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Navbar />
        <main className="relative z-0 flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
