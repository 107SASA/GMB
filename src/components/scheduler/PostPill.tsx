import React from 'react';

interface PostPillProps {
  post: any;
  onPublish: (id: string) => void;
  onSchedule: (id: string) => void;
}

export default function PostPill({ post, onPublish, onSchedule }: PostPillProps) {
  const statusColors = {
    published: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
    draft: 'bg-amber-100 text-amber-800 border-amber-200',
    failed: 'bg-rose-100 text-rose-800 border-rose-200',
  };

  const statusColor = statusColors[post.status as keyof typeof statusColors] || statusColors.draft;

  return (
    <div className={`p-3 rounded-lg border shadow-sm mb-2 transition-transform hover:-translate-y-0.5 cursor-pointer flex flex-col gap-2 ${statusColor} bg-opacity-50 hover:bg-opacity-100 bg-white`}>
      <div className="flex justify-between items-start">
        <span className="text-xs font-bold uppercase tracking-wider">{post.status}</span>
        {post.aiGenerated && (
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">AI</span>
        )}
      </div>
      <h4 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">{post.title}</h4>
      <p className="text-xs text-slate-600 truncate">{post.content}</p>
      
      <div className="mt-2 flex gap-1 justify-end border-t border-black/5 pt-2">
        {post.status === 'draft' && (
          <button onClick={(e) => { e.stopPropagation(); onSchedule(post._id); }} className="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-200 px-2 py-1 rounded">Schedule</button>
        )}
        {post.status === 'scheduled' && (
          <button onClick={(e) => { e.stopPropagation(); onPublish(post._id); }} className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-200 px-2 py-1 rounded">Publish Now</button>
        )}
      </div>
    </div>
  );
}
