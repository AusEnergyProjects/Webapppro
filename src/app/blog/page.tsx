import { permanentRedirect } from "next/navigation";

export default function LegacyBlogIndexPage() {
  permanentRedirect("/guides");
}
