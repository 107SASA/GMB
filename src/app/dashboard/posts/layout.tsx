"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { name: "All Posts", href: "/dashboard/posts" },
  { name: "Pending", href: "/dashboard/posts/pending" },
  { name: "Scheduled", href: "/dashboard/posts/scheduled" },
  { name: "Create Post", href: "/dashboard/posts/create" },
];

export default function PostsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">My Posts</h1>
        <p className="text-slate-500">Manage all your content posts</p>
      </div>

      <div className="flex gap-2 p-1 bg-white border border-slate-200 rounded-2xl w-fit shadow-sm">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                "px-6 py-2.5 rounded-xl font-medium text-sm transition-all",
                isActive
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>

      <div>
        {children}
      </div>
    </div>
  );
}
