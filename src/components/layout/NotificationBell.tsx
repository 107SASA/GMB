"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, AlertTriangle, MessageSquare, Star, Loader2, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";

interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<string, typeof Star> = {
  critical_review: AlertTriangle,
  reply_drafted: MessageSquare,
  review_received: Star,
};
const TYPE_COLOR: Record<string, string> = {
  critical_review: "bg-error-container text-error",
  reply_drafted: "bg-primary-fixed text-primary",
  review_received: "bg-secondary-container/40 text-secondary",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=15");
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setItems(json.notifications);
        setUnread(json.unreadCount);
      }
    } catch {
      /* silent — the bell is never worth an error state */
    }
  }, []);

  // Initial load + refresh every 60s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await fetchNotifications();
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    setUnread(0);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch { /* optimistic */ }
  };

  const handleItemClick = async (n: NotificationItem) => {
    if (!n.read) {
      setItems(prev => prev.map(i => i._id === n._id ? { ...i, read: true } : i));
      setUnread(u => Math.max(0, u - 1));
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n._id }),
      }).catch(() => {});
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-surface flex items-center justify-center hover:bg-surface-container transition-all border border-outline-variant"
      >
        <Bell className="w-4 h-4 lg:w-5 lg:h-5 text-on-surface-variant" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 sm:w-96 bg-surface-container-lowest rounded-2xl border border-outline-variant card-shadow z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
            <p className="text-sm font-bold text-on-surface">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-container"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="py-10 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-outline" />
              </div>
            ) : items.length === 0 ? (
              <div className="py-10 px-6 text-center">
                <Bell className="w-8 h-8 text-outline-variant mx-auto mb-2" />
                <p className="text-sm font-bold text-on-surface">No notifications yet</p>
                <p className="text-xs text-outline mt-1">Review alerts and campaign updates will show up here.</p>
              </div>
            ) : (
              items.map(n => {
                const Icon = TYPE_ICON[n.type] || Bell;
                const color = TYPE_COLOR[n.type] || "bg-surface-container text-on-surface-variant";
                return (
                  <button
                    key={n._id}
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 border-b border-outline-variant last:border-b-0 hover:bg-surface transition-colors ${!n.read ? "bg-primary-fixed/40" : ""}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm ${!n.read ? "font-bold text-on-surface" : "font-medium text-on-surface"}`}>{n.title}</p>
                      <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-outline mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 ml-auto" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
