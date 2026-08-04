"use client";
import { useState, useEffect } from "react";
import { Search, Filter, Clock, FileText, Trash2, X, ChevronLeft, ChevronRight, Copy, Check } from "lucide-react";
import { useBusiness } from '@/context/BusinessContext';

export default function HistoryPage() {
  const { activeBusiness } = useBusiness();
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [filters, setFilters] = useState({ page: 1, search: "", content_type: "" });
  const [total, setTotal] = useState(0);

  const LIMIT = 10;
  const totalPages = Math.ceil(total / LIMIT);

  // Refetch on workspace switch too — /api/posts is scoped to the active
  // business server-side, but this component previously only refired on
  // filter changes, so switching workspaces left it showing the PREVIOUS
  // workspace's content history until a full reload.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetchHistory();
  }, [filters, activeBusiness?._id]);

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
        <h1 className="text-4xl font-bold text-on-surface mb-2">Content History</h1>
        <p className="text-on-surface-variant">Review and manage your AI-generated posts.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 bg-surface-container-lowest shadow-sm p-4 rounded-xl border border-outline-variant">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-outline" />
          <input
            type="text"
            placeholder="Search titles or content..."
            value={filters.search}
            onChange={(e) => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))}
            className="w-full bg-surface border border-outline-variant text-on-surface placeholder:text-outline rounded-2xl pl-12 pr-4 py-3 outline-none focus:border-primary shadow-sm"
          />
        </div>
        <div className="flex gap-4">
          <select
            value={filters.content_type}
            onChange={(e) => setFilters(f => ({ ...f, content_type: e.target.value, page: 1 }))}
            className="bg-surface border border-outline-variant text-on-surface rounded-2xl px-4 py-3 outline-none focus:border-primary min-w-[160px] shadow-sm"
          >
            <option value="" className="bg-surface-container-lowest">All Types</option>
            <option value="gmb_post" className="bg-surface-container-lowest">GMB Posts</option>
            <option value="seo_description" className="bg-surface-container-lowest">SEO Bios</option>
            <option value="faq" className="bg-surface-container-lowest">FAQs</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-sm">
            {isLoading ? (
              <div className="p-8 text-center text-on-surface-variant">Loading history...</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Clock className="w-10 h-10 text-outline mb-4" />
                <p className="text-on-surface font-semibold">No content found</p>
                <p className="text-on-surface-variant text-sm mt-2">Generate some content first!</p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant">
                {items.map((item) => (
                  <div
                    key={item._id}
                    onClick={() => setSelected(item)}
                    className={`flex items-center gap-4 p-5 cursor-pointer transition-all hover:bg-surface ${selected?._id === item._id ? 'bg-surface border-r-4 border-primary' : ''}`}
                  >
                    <div className="w-12 h-12 bg-primary-fixed rounded-xl flex items-center justify-center flex-shrink-0 text-primary">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-on-surface truncate">{item.title}</p>
                      <p className="text-sm text-on-surface-variant mt-1">
                        {formatContentType(item.contentType)} · {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="px-3 py-1 rounded-full text-xs font-semibold bg-secondary-container/40 text-secondary border border-secondary-fixed">
                        SEO {item.seoScore || 70}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(item._id); }} className="p-2 rounded-xl hover:bg-error-container text-outline hover:text-error transition">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 text-on-surface-variant">
              <p>Showing page {filters.page} of {totalPages || 1}</p>
              <div className="flex gap-2">
                <button onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page <= 1} className="p-3 bg-surface-container-lowest border border-outline-variant shadow-sm rounded-xl hover:bg-surface disabled:opacity-30">
                  <ChevronLeft className="w-5 h-5 text-on-surface" />
                </button>
                <button onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page >= totalPages} className="p-3 bg-surface-container-lowest border border-outline-variant shadow-sm rounded-xl hover:bg-surface disabled:opacity-30">
                  <ChevronRight className="w-5 h-5 text-on-surface" />
                </button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <div className="w-full lg:w-96 bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm h-fit lg:sticky lg:top-8">
            <div className="flex items-start justify-between border-b border-outline-variant pb-4 mb-4">
              <h3 className="font-bold text-on-surface pr-4">{selected.title}</h3>
              <button onClick={() => setSelected(null)} className="text-outline hover:text-on-surface transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-5">
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-primary-fixed text-primary text-xs rounded-full font-medium border border-primary-fixed-dim">
                  {formatContentType(selected.contentType)}
                </span>
                <span className="px-3 py-1 bg-primary-fixed text-primary text-xs rounded-full font-medium border border-primary-fixed-dim">
                  {selected.tone || 'Professional'}
                </span>
              </div>

              <div>
                <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-2">Content</p>
                <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{selected.content}</p>
              </div>

              {selected.cta && (
                <div>
                  <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-2">Call To Action</p>
                  <p className="text-sm font-medium text-primary bg-primary-fixed border border-primary-fixed-dim p-3 rounded-xl">{selected.cta}</p>
                </div>
              )}

              {selected.hashtags?.length > 0 && (
                <div>
                  <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-2">Hashtags</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.hashtags.map((h: string) => (
                      <span key={h} className="px-3 py-1 bg-surface-container text-on-surface-variant text-xs rounded-full">#{h}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-outline-variant">
                <button onClick={() => handleCopy(selected.content)} className="flex-1 flex justify-center items-center gap-2 bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary transition shadow-sm">
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
