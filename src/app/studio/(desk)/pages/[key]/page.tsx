import { notFound } from "next/navigation";
import { getCmsPage } from "@/lib/cms/pages";
import { PageEditor } from "@/components/studio/PageEditor";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!getCmsPage(key)) notFound();
  return <PageEditor pageKey={key} />;
}
