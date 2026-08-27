import type { Metadata } from "next";
import { ShowcasePage } from "@/components/pages/ShowcasePage";

export const metadata: Metadata = {
  title: "Showcase",
  description:
    "Real photos, video, and reviews shared by businesses on GrowwMatics AI — reviewed and approved by our team before they're posted.",
  alternates: { canonical: "/showcase" },
};

export default function Page() {
  return <ShowcasePage />;
}
