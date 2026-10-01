import { redirect } from "next/navigation";

export default function DirectTradePartnersPage() {
  redirect("/direct-trade/dashboard?setup=1");
}
