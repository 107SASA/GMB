import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogIndexRoute, blogIndexMetadata } from "@/components/blog/blogRoutes";

export const revalidate = 600;
// Built on first visit, then cached (no DB needed at build time).
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ page: string }> };

const toPage = (raw: string) => (/^[0-9]{1,4}$/.test(raw) ? Number(raw) : NaN);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = toPage((await params).page);
  return blogIndexMetadata("en", Number.isFinite(page) ? page : 1);
}

export default async function Page({ params }: Props) {
  const page = toPage((await params).page);
  if (!Number.isFinite(page) || page < 2) notFound();
  return <BlogIndexRoute lang="en" page={page} />;
}
