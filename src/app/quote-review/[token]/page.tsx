import { QuoteLinkReview } from "@/components/QuoteLinkReview";

export const dynamic = "force-dynamic";

export default async function QuoteReviewPage({ params }: { params: Promise<{ token: string }> }) {
  return <QuoteLinkReview token={(await params).token} />;
}
