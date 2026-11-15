import type { Metadata } from "next";
import Planner from "@/components/Planner";

export const metadata: Metadata = {
  title: "Tool | Lunar Landing Site Navigator",
};

export default function ToolPage() {
  return <Planner />;
}
