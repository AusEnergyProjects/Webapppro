import { notFound, permanentRedirect } from "next/navigation";
import { resolveLegacyBlogRedirect } from "@/lib/legacy-blog-redirects.mjs";

export default async function LegacyBlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destination = resolveLegacyBlogRedirect(slug);
  if (destination) permanentRedirect(destination);
  notFound();
}
