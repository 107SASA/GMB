import { notFound } from "next/navigation";
import { PostEditor } from "@/components/studio/PostEditor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return <PostEditor id={id} />;
}
