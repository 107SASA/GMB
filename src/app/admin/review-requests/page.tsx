'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface HistoryEntry {
  sid: string | null;
  templateSid: string | null;
  templateKind: string | null;
  stage: string | null;
  status: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  failedAt: string | null;
}

interface AdminRequest {
  reviewRequestId: string;
  customerName: string;
  customerPhone: string;
  businessName: string;
  provider: string;
  status: string;
  statusLabel: string;
  templateSid: string | null;
  lastMessageSid: string | null;
  messageSids: string[];
  errorCode: string | null;
  errorMessage: string | null;
  failedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  clickedAt: string | null;
  clickCount: number;
  followUpLabel: string;
  messageHistory: HistoryEntry[];
}

function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminReviewRequestsPage() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [errorCode, setErrorCode] = useState('');
  const [appliedCode, setAppliedCode] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, page: String(page) });
      if (appliedCode) params.set('errorCode', appliedCode);
      const res = await fetch(`/api/admin/review-requests?${params}`);
      const json = await res.json();
      if (json.success) {
        setRequests(json.requests);
        setTotalPages(json.totalPages || 1);
      }
    } finally {
      setLoading(false);
    }
  }, [status, appliedCode, page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Review Requests</h1>
          <p className="text-sm text-on-surface-variant">WhatsApp delivery diagnostics. Clicks are not counted as Google reviews.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(event) => { setPage(1); setStatus(event.target.value); }}
          className="px-4 py-2.5 text-sm border border-outline-variant rounded-xl bg-surface-container-lowest"
        >
          <option value="all">All statuses</option>
          <option value="Pending">Pending</option>
          <option value="Sent">Sent</option>
          <option value="Delivered">Delivered</option>
          <option value="Read">Read</option>
          <option value="Failed">Failed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedCode(errorCode.trim());
          }}
        >
          <input
            value={errorCode}
            onChange={(event) => setErrorCode(event.target.value)}
            placeholder="Error code, e.g. 63049"
            className="px-4 py-2.5 text-sm border border-outline-variant rounded-xl bg-surface-container-lowest"
          />
          <button type="submit" className="px-4 py-2.5 text-sm font-bold text-white bg-primary rounded-xl">Filter</button>
        </form>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-outline">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">Loading…</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">No review requests match these filters.</td></tr>
              ) : requests.map((request) => (
                <Fragment key={request.reviewRequestId}>
                  <tr className="text-on-surface">
                    <td className="px-4 py-3">
                      <p className="font-bold">{request.customerName}</p>
                      <p className="text-xs text-outline">{request.customerPhone || '—'}</p>
                    </td>
                    <td className="px-4 py-3">{request.businessName}</td>
                    <td className="px-4 py-3">{request.status}</td>
                    <td className="px-4 py-3">{request.errorCode || '—'}</td>
                    <td className="px-4 py-3">{when(request.sentAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === request.reviewRequestId ? null : request.reviewRequestId)}
                        className="text-xs font-bold text-primary"
                      >
                        {openId === request.reviewRequestId ? 'Hide' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                  {openId === request.reviewRequestId && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 bg-surface-container-low text-xs text-on-surface">
                        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                          <div><dt className="text-outline">Review request</dt><dd className="font-mono break-all">{request.reviewRequestId}</dd></div>
                          <div><dt className="text-outline">Provider</dt><dd>{request.provider}</dd></div>
                          <div><dt className="text-outline">Message SID</dt><dd className="font-mono break-all">{request.lastMessageSid || '—'}</dd></div>
                          <div><dt className="text-outline">Template SID</dt><dd className="font-mono break-all">{request.templateSid || '—'}</dd></div>
                          <div><dt className="text-outline">Error</dt><dd>{request.errorCode || '—'} {request.errorMessage || ''}</dd></div>
                          <div><dt className="text-outline">Failed at</dt><dd>{when(request.failedAt)}</dd></div>
                          <div><dt className="text-outline">Delivered at</dt><dd>{when(request.deliveredAt)}</dd></div>
                          <div><dt className="text-outline">Read at</dt><dd>{when(request.readAt)}</dd></div>
                          <div><dt className="text-outline">Clicked at</dt><dd>{when(request.clickedAt)} ({request.clickCount} click{request.clickCount === 1 ? '' : 's'})</dd></div>
                          <div><dt className="text-outline">Follow-up</dt><dd>{request.followUpLabel}</dd></div>
                        </dl>
                        {request.messageHistory.length > 0 && (
                          <div className="mt-4">
                            <p className="font-bold mb-2">Message history</p>
                            <ul className="space-y-2">
                              {request.messageHistory.map((entry, index) => (
                                <li key={`${entry.sid || 'attempt'}-${index}`} className="font-mono break-all">
                                  {entry.stage || 'send'} · {entry.status || '—'} · {entry.templateKind || '—'} · {entry.sid || 'no sid'}
                                  {entry.errorCode ? ` · ${entry.errorCode} ${entry.errorMessage || ''}` : ''}
                                  {entry.templateSid ? ` · template ${entry.templateSid}` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {request.messageSids.length > 0 && (
                          <p className="mt-3 font-mono break-all">All SIDs: {request.messageSids.join(', ')}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="px-3 py-1.5 rounded-lg border border-outline-variant disabled:opacity-40">Previous</button>
        <span className="text-on-surface-variant">{page} / {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="px-3 py-1.5 rounded-lg border border-outline-variant disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
