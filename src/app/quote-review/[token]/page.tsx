import { QuoteLinkReview } from "@/components/QuoteLinkReview";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    nosnippet: true,
  },
  referrer: "no-referrer",
};

export default async function QuoteReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <QuoteLinkReview token={(await params).token} />;
}
