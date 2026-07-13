import { BrandBar, ComparatorHero } from "@/components/ComparatorChrome";
import { NativeElectricityComparator } from "@/components/electricity/NativeElectricityComparator";

export const metadata = {
  title: "Native Electricity Comparison Preview | Australian Energy Assessments",
  robots: { index: false, follow: false },
};

export default function NativeElectricityPreviewPage() {
  return <main className="wrap">
    <BrandBar />
    <nav aria-label="Energy comparison" className="comparator-nav"><a className="active" href="/compare">Live electricity compare</a><a className="inactive" href="/gas-compare">Gas compare</a></nav>
    <ComparatorHero title="Electricity comparison test route"><p>This noindex route exercises the same native comparison engine as the live electricity comparer.</p><div className="fresh"><span className="dot" /> Internal regression route</div></ComparatorHero>
    <NativeElectricityComparator preview />
    <footer><p>Internal regression route. Use the live electricity comparer at /compare.</p></footer>
  </main>;
}
