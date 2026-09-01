import { permanentRedirect } from "next/navigation";

export default function LegacyNathersExistingHomesPage() {
  permanentRedirect("/home-energy-rating-for-existing-homes");
}
