import { Suspense } from "react";
import { PostList } from "@/components/studio/PostList";

export default function Page() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-container" />}>
      <PostList />
    </Suspense>
  );
}
