import type { Metadata } from "next";

const APEX_ORIGIN = "https://ausenergyassessments.com";
const PLATFORM_ORIGIN = "https://compare.ausenergyassessments.com";
const APEX_WEBSITE_ID = `${APEX_ORIGIN}/#website`;
const PLATFORM_WEBSITE_ID = `${PLATFORM_ORIGIN}/#website`;

export const PUBLIC_SITE = {
  name: "Australian Energy Assessments",
  legalName: "Australian Energy Assessments Pty Ltd",
  abn: "73 675 233 557",
  apexUrl: APEX_ORIGIN,
  platformUrl: PLATFORM_ORIGIN,
  organizationId: `${APEX_ORIGIN}/#organization`,
  apexWebsiteId: APEX_WEBSITE_ID,
  platformWebsiteId: PLATFORM_WEBSITE_ID,
  websiteId: PLATFORM_WEBSITE_ID,
  phoneDisplay: "1300 241 149",
  phoneHref: "tel:+611300241149",
  telephone: "+61-1300-241-149",
  email: "info@ausenergyassessments.com",
  address: {
    streetAddress: "152 Elizabeth Street",
    addressLocality: "Melbourne",
    addressRegion: "VIC",
    postalCode: "3000",
    addressCountry: "AU",
  },
  googleBusinessProfile:
    "https://www.google.com/maps/place/?q=place_id:ChIJS2WVhrVD1moRFxEPRjRPxtE",
  facebook: "https://www.facebook.com/ausenergyassessments/",
  instagram: "https://www.instagram.com/ausenergyassessments",
  linkedin: "https://au.linkedin.com/company/australian-energy-assessments",
  twitter: "https://twitter.com/AusEnergyAssess",
  logo: `${PLATFORM_ORIGIN}/aea-brandmark.svg`,
} as const;

export const publicOrganizationSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProfessionalService",
      "@id": PUBLIC_SITE.organizationId,
      name: PUBLIC_SITE.name,
      legalName: PUBLIC_SITE.legalName,
      description:
        "Independent home energy assessment, NatHERS, Home Energy Rating and residential energy guidance services.",
      url: `${PUBLIC_SITE.apexUrl}/`,
      logo: {
        "@type": "ImageObject",
        url: PUBLIC_SITE.logo,
      },
      telephone: PUBLIC_SITE.telephone,
      email: PUBLIC_SITE.email,
      identifier: {
        "@type": "PropertyValue",
        propertyID: "ABN",
        value: PUBLIC_SITE.abn,
      },
      address: {
        "@type": "PostalAddress",
        ...PUBLIC_SITE.address,
      },
      areaServed: {
        "@type": "Country",
        name: "Australia",
      },
      hasMap: PUBLIC_SITE.googleBusinessProfile,
      sameAs: [
        PUBLIC_SITE.googleBusinessProfile,
        PUBLIC_SITE.facebook,
        PUBLIC_SITE.instagram,
        PUBLIC_SITE.linkedin,
        PUBLIC_SITE.twitter,
      ],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: PUBLIC_SITE.telephone,
        email: PUBLIC_SITE.email,
        availableLanguage: "English",
      },
    },
    {
      "@type": "WebSite",
      "@id": PUBLIC_SITE.apexWebsiteId,
      url: `${PUBLIC_SITE.apexUrl}/`,
      name: PUBLIC_SITE.name,
      inLanguage: "en-AU",
      publisher: { "@id": PUBLIC_SITE.organizationId },
    },
    {
      "@type": "WebSite",
      "@id": PUBLIC_SITE.platformWebsiteId,
      url: `${PUBLIC_SITE.platformUrl}/`,
      name: "Australian Energy Assessments home energy platform",
      inLanguage: "en-AU",
      publisher: { "@id": PUBLIC_SITE.organizationId },
    },
  ],
} as const;

export function buildApexMetadata({
  path,
  title,
  description,
}: {
  path: `/${string}` | "/";
  title: string;
  description: string;
}): Metadata {
  const canonical = new URL(path, `${APEX_ORIGIN}/`).toString();

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: PUBLIC_SITE.name,
      locale: "en_AU",
      images: [{
        url: `${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`,
        width: 1731,
        height: 909,
        alt: "Australian Energy Assessments home energy services and guidance",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`],
    },
  };
}

export function buildPlatformMetadata({
  path,
  title,
  description,
}: {
  path: `/${string}` | "/";
  title: string;
  description: string;
}): Metadata {
  const canonical = new URL(path, `${PLATFORM_ORIGIN}/`).toString();

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: PUBLIC_SITE.name,
      locale: "en_AU",
      images: [
        {
          url: `${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`,
          width: 1731,
          height: 909,
          alt: "Australian Energy Assessments home energy planning and assessment platform",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`],
    },
  };
}

export function buildGuideMetadata({
  path,
  title,
  description,
  publishedIso,
  reviewedIso,
}: {
  path: `/${string}`;
  title: string;
  description: string;
  publishedIso: `${number}-${number}-${number}`;
  reviewedIso: `${number}-${number}-${number}`;
}): Metadata {
  const canonical = new URL(path, `${PLATFORM_ORIGIN}/`).toString();

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      siteName: PUBLIC_SITE.name,
      locale: "en_AU",
      publishedTime: publishedIso,
      modifiedTime: reviewedIso,
      authors: [`${PUBLIC_SITE.apexUrl}/`],
      images: [{
        url: `${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`,
        width: 1731,
        height: 909,
        alt: "Australian Energy Assessments home energy guidance",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${PLATFORM_ORIGIN}/aea-home-energy-plan-og-v2.png`],
    },
  };
}
