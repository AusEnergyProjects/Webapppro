import { permanentRedirect } from "next/navigation";

export default function LegacyEmailPage() {
  permanentRedirect("/book-an-assessment");
}
