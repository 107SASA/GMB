import type { Metadata } from "next";
import { BlogIndexRoute, blogIndexMetadata } from "@/components/blog/blogRoutes";

// Pre-built; rebuilt the moment a post is published (revalidatePath) and at
// most every 10 minutes as a safety net.
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  return blogIndexMetadata("en");
}

export default function Page() {
  return <BlogIndexRoute lang="en" />;
}
