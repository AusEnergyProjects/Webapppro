import type { Metadata } from "next";
import { JobInformationUpload } from "@/components/JobInformationUpload";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Upload requested job photos | TLink",
  description: "Privately add the photos requested by your installer.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function JobInformationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JobInformationUpload token={token} />;
}
