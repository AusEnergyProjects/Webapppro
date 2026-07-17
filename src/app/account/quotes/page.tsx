export const dynamic = "force-dynamic";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export default function AccountQuotesPage() {
  return <CustomerDashboard initialView="quotes" />;
}
