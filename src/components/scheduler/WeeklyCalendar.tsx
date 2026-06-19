import React from 'react';
import PostPill from './PostPill';

interface WeeklyCalendarProps {
  posts: any[];
  onPublish: (id: string) => void;
  onSchedule: (id: string) => void;
}

export default function WeeklyCalendar({ posts, onPublish, onSchedule }: WeeklyCalendarProps) {
  // Generate array of next 7 days
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const getPostsForDay = (date: Date) => {
    return posts.filter(p => {
      if (!p.scheduledDate) return false;
      const pd = new Date(p.scheduledDate);
      return pd.getDate() === date.getDate() && pd.getMonth() === date.getMonth();
    });
  };

  const getDrafts = () => posts.filter(p => p.status === 'draft');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {days.map((day, i) => (
          <div key={i} className="p-4 text-center border-r border-slate-200 last:border-r-0">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {day.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div className={`text-xl font-bold mt-1 ${i === 0 ? 'text-blue-600' : 'text-slate-900'}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 min-h-[400px]">
        {days.map((day, i) => {
          const dayPosts = getPostsForDay(day);
          return (
            <div key={i} className="p-3 border-r border-slate-200 last:border-r-0 bg-slate-50/30">
              {dayPosts.map(post => (
                <PostPill key={post._id} post={post} onPublish={onPublish} onSchedule={onSchedule} />
              ))}
              {dayPosts.length === 0 && (
                <div className="h-full w-full flex items-center justify-center border-2 border-dashed border-slate-200 rounded-lg text-xs text-slate-400 font-medium p-4 text-center">
                  Drop post here
                </div>
              )}
            </div>
          );
        })}
      </div>

      {getDrafts().length > 0 && (
        <div className="p-6 border-t border-slate-200 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Unscheduled Drafts</h3>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {getDrafts().map(post => (
              <div key={post._id} className="w-64 flex-shrink-0">
                <PostPill post={post} onPublish={onPublish} onSchedule={onSchedule} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
