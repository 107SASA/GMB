import type { Metadata } from "next";
import { BlogCategoryRoute, blogCategoryMetadata } from "@/components/blog/blogRoutes";

export const revalidate = 600;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogCategoryMetadata("hi", (await params).slug);
}

export default async function Page({ params }: Props) {
  return <BlogCategoryRoute lang="hi" slug={(await params).slug} />;
}
