import type { Metadata } from "next";
import { Suspense } from "react";
import NavigatorApp, { NavigatorSkeleton } from "@/components/navigator/NavigatorApp";

export const metadata: Metadata = {
  title: "Navigator | Artemis Assist",
  description:
    "Rank the south pole regions NASA named for Artemis III in 2024 by real-terrain sunlight and Earth visibility for any 2027 mission window.",
};

export default function ToolPage() {
  // The app reads its view from the URL, so it renders below a Suspense boundary.
  return (
    <Suspense fallback={<NavigatorSkeleton />}>
      <NavigatorApp />
    </Suspense>
  );
}
