import type { Metadata } from "next";
import { BlogPostRoute, blogPostMetadata } from "@/components/blog/blogRoutes";

// Each article is built on its first visit and cached; publishing, editing or
// taking it down rebuilds it immediately (revalidatePath in lib/blog/workflow).
export const revalidate = 3600;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogPostMetadata("hi", (await params).slug);
}

export default async function Page({ params }: Props) {
  return <BlogPostRoute lang="hi" slug={(await params).slug} />;
}
