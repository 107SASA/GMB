import { blogRss } from "@/components/blog/blogRoutes";

export const revalidate = 3600;

export function GET() {
  return blogRss("en");
}
