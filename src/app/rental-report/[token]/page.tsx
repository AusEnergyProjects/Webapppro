import type { Metadata } from "next";
import { RentalReportViewer } from "@/components/RentalReportViewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  title: "Rental assessment report | TLink",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    nosnippet: true,
  },
  referrer: "no-referrer",
};

export default async function RentalReportPage({ params }: { params: Promise<{ token: string }> }) {
  return <RentalReportViewer token={(await params).token} />;
}
