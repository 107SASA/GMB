'use client';

import { GeneratedPost } from '@/services/ai/contentEngine';
import PostCard from './PostCard';

interface WeeklyPostsTabProps {
  posts: GeneratedPost[];
}

export default function WeeklyPostsTab({ posts }: WeeklyPostsTabProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Your Generated Posts</h3>
          <p className="text-slate-500 text-sm mt-1">Review and schedule these posts directly to your Google Business Profile.</p>
        </div>
        <button className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors shadow-sm">
          Schedule All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {posts.map((post, index) => (
          <PostCard key={index} post={post} index={index} />
        ))}
      </div>
    </div>
  );
}
