import { permanentRedirect } from "next/navigation";

export default function LegacyELearningResourcesPage() {
  permanentRedirect("/guides");
}
