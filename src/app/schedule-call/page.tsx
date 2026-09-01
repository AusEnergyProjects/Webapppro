import { permanentRedirect } from "next/navigation";

export default function LegacyScheduleCallPage() {
  permanentRedirect("/book-an-assessment");
}
