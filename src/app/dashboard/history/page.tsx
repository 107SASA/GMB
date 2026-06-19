"use client";
import { useState, useEffect } from "react";
import { Search, Filter, Clock, FileText, Trash2, X, ChevronLeft, ChevronRight, Copy, Check } from "lucide-react";

export default function HistoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [filters, setFilters] = useState({ page: 1, search: "", content_type: "" });
  const [total, setTotal] = useState(0);

  const LIMIT = 10;
  const totalPages = Math.ceil(total / LIMIT);

  useEffect(() => {
    fetchHistory();
  }, [filters]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      // Assuming GET /api/posts handles aiGenerated filtering. We will filter in UI or update API.
      const query = new URLSearchParams({
        aiGenerated: "true",
        page: filters.page.toString(),
        limit: LIMIT.toString(),
        search: filters.search,
        contentType: filters.content_type
      });
      const res = await fetch(`/api/posts?${query.toString()}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data.filter((d: any) => d.aiGenerated) : []);
      setTotal(Array.isArray(data) ? data.filter((d: any) => d.aiGenerated).length : 0);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this content permanently?")) return;
    try {
      await fetch(`/api/posts/${id}`, { method: "DELETE" });
      setItems(items.filter(i => i._id !== id));
      if (selected?._id === id) setSelected(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatContentType = (type: string) => type?.replace('_', ' ')?.toUpperCase() || "POST";
  const formatDate = (date: string) => new Date(date).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Content History</h1>
        <p className="text-slate-500">Review and manage your AI-generated posts.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 bg-white shadow-sm p-4 rounded-3xl border border-slate-200">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search titles or content..."
            value={filters.search}
            onChange={(e) => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))}
            className="w-full bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-2xl pl-12 pr-4 py-3 outline-none focus:border-primary shadow-sm"
          />
        </div>
        <div className="flex gap-4">
          <select
            value={filters.content_type}
            onChange={(e) => setFilters(f => ({ ...f, content_type: e.target.value, page: 1 }))}
            className="bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3 outline-none focus:border-primary min-w-[160px] shadow-sm"
          >
            <option value="" className="bg-white">All Types</option>
            <option value="gmb_post" className="bg-white">GMB Posts</option>
            <option value="seo_description" className="bg-white">SEO Bios</option>
            <option value="faq" className="bg-white">FAQs</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            {isLoading ? (
              <div className="p-8 text-center text-slate-500">Loading history...</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Clock className="w-10 h-10 text-slate-300 mb-4" />
                <p className="text-slate-900 font-semibold">No content found</p>
                <p className="text-slate-500 text-sm mt-2">Generate some content first!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {items.map((item) => (
                  <div
                    key={item._id}
                    onClick={() => setSelected(item)}
                    className={`flex items-center gap-4 p-5 cursor-pointer transition-all hover:bg-slate-50 ${selected?._id === item._id ? 'bg-slate-50 border-r-4 border-primary' : ''}`}
                  >
                    <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0 text-purple-600">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{item.title}</p>
                      <p className="text-sm text-slate-500 mt-1">
                        {formatContentType(item.contentType)} · {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
                        SEO {item.seoScore || 70}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(item._id); }} className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 text-slate-500">
              <p>Showing page {filters.page} of {totalPages || 1}</p>
              <div className="flex gap-2">
                <button onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page <= 1} className="p-3 bg-white border border-slate-200 shadow-sm rounded-xl hover:bg-slate-50 disabled:opacity-30">
                  <ChevronLeft className="w-5 h-5 text-slate-900" />
                </button>
                <button onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page >= totalPages} className="p-3 bg-white border border-slate-200 shadow-sm rounded-xl hover:bg-slate-50 disabled:opacity-30">
                  <ChevronRight className="w-5 h-5 text-slate-900" />
                </button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <div className="w-full lg:w-96 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm h-fit sticky top-8">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4 mb-4">
              <h3 className="font-bold text-slate-900 pr-4">{selected.title}</h3>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-900 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-5">
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-purple-50 text-purple-600 text-xs rounded-full font-medium border border-purple-200">
                  {formatContentType(selected.contentType)}
                </span>
                <span className="px-3 py-1 bg-blue-50 text-blue-600 text-xs rounded-full font-medium border border-blue-200">
                  {selected.tone || 'Professional'}
                </span>
              </div>

              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Content</p>
                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{selected.content}</p>
              </div>

              {selected.cta && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Call To Action</p>
                  <p className="text-sm font-medium text-purple-700 bg-purple-50 border border-purple-100 p-3 rounded-xl">{selected.cta}</p>
                </div>
              )}

              {selected.hashtags?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Hashtags</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.hashtags.map((h: string) => (
                      <span key={h} className="px-3 py-1 bg-slate-100 text-slate-600 text-xs rounded-full">#{h}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button onClick={() => handleCopy(selected.content)} className="flex-1 flex justify-center items-center gap-2 bg-slate-900 text-white font-semibold py-3 rounded-xl hover:bg-slate-800 transition shadow-sm">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
