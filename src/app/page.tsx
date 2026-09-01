import type { Metadata } from "next";
import { GettingStarted } from "@/components/GettingStarted";
import { JsonLd } from "@/components/JsonLd";
import { PUBLIC_SITE } from "@/lib/public-site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const homepageSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${PUBLIC_SITE.platformUrl}/#webpage`,
      url: `${PUBLIC_SITE.platformUrl}/`,
      name: "Australian Energy Assessments | Home Energy Assessments and NatHERS",
      description: "Independent home energy assessment guidance, NatHERS services, planning tools, rebates and energy comparison for Australian homes.",
      inLanguage: "en-AU",
      isPartOf: { "@id": PUBLIC_SITE.platformWebsiteId },
      about: { "@id": PUBLIC_SITE.organizationId },
      mainEntity: { "@id": `${PUBLIC_SITE.platformUrl}/#assessment-pathways` },
    },
    {
      "@type": "ItemList",
      "@id": `${PUBLIC_SITE.platformUrl}/#assessment-pathways`,
      name: "Australian home energy assessment pathways",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "NatHERS for new homes", url: `${PUBLIC_SITE.apexUrl}/nathers-for-new-homes` },
        { "@type": "ListItem", position: 2, name: "Home Energy Rating for existing homes", url: `${PUBLIC_SITE.apexUrl}/home-energy-rating-for-existing-homes` },
        { "@type": "ListItem", position: 3, name: "NatHERS Whole of Home", url: `${PUBLIC_SITE.apexUrl}/nathers-whole-of-home` },
        { "@type": "ListItem", position: 4, name: "BASIX assessment support", url: `${PUBLIC_SITE.apexUrl}/basix-nsw` },
      ],
    },
  ],
};

export default function Home() {
  return <><JsonLd data={homepageSchema} /><GettingStarted /></>;
}
