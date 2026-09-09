import { permanentRedirect } from "next/navigation";
import { retiredProjectPlannerPath } from "@/lib/customer-account-retirement.mjs";

export default async function RetiredProjectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  permanentRedirect(retiredProjectPlannerPath(await searchParams));
}
