'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UploadCloud, MessageSquare, Mail, Users, TrendingUp, Send } from 'lucide-react';
import CustomerUploadModal from '@/components/campaigns/CustomerUploadModal';

export default function ReviewCampaignsDashboard() {
  const [showUpload, setShowUpload] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  
  const businessId = '60b9b3b3b3b3b3b3b3b3b3b3'; 
  const tenantId = 'demo-tenant';

  // Note: in a real app, this would be a proper GET /api/campaigns/customers endpoint
  // We'll mock the fetch for the UI demonstration, or call a generic fetch if we built it.
  const fetchCustomers = useCallback(async () => {
    // For MVP, we pretend to fetch. In a real scenario we'd query the Customer model.
    setLoading(true);
    setTimeout(() => {
      setCustomers([
        { _id: '1', name: 'Alice Smith', phone: '+1234567890', service: 'Plumbing Repair', reviewStatus: 'Pending', optedOut: false },
        { _id: '2', name: 'Bob Johnson', phone: '+1987654321', service: 'HVAC Install', reviewStatus: 'Requested', optedOut: false },
        { _id: '3', name: 'Carol White', phone: '+1122334455', service: 'Maintenance', reviewStatus: 'Completed', optedOut: false },
        { _id: '4', name: 'Dave Brown', phone: '+1555666777', service: 'Inspection', reviewStatus: 'Pending', optedOut: true },
      ]);
      setLoading(false);
    }, 800);
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleSendCampaign = async (customerId: string) => {
    setSendingId(customerId);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, businessId, tenantId, channel: 'whatsapp' })
      });
      if (res.ok) {
        setCustomers(prev => prev.map(c => c._id === customerId ? { ...c, reviewStatus: 'Requested' } : c));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 pt-10">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">Reputation Campaigns</h1>
            <p className="text-sm text-slate-500">Acquire 5-star reviews using AI-powered drip campaigns.</p>
          </div>
          <button 
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            <UploadCloud className="w-4 h-4" />
            Import Customers
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2 text-indigo-600">
              <Users className="w-5 h-5" />
              <h3 className="font-bold text-sm">Customers</h3>
            </div>
            <p className="text-2xl font-bold text-slate-900">1,204</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2 text-blue-500">
              <Send className="w-5 h-5" />
              <h3 className="font-bold text-sm">Requests Sent</h3>
            </div>
            <p className="text-2xl font-bold text-slate-900">856</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2 text-amber-500">
              <TrendingUp className="w-5 h-5" />
              <h3 className="font-bold text-sm">Click Rate</h3>
            </div>
            <p className="text-2xl font-bold text-slate-900">42%</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2 text-emerald-500">
              <MessageSquare className="w-5 h-5" />
              <h3 className="font-bold text-sm">New Reviews</h3>
            </div>
            <p className="text-2xl font-bold text-slate-900">112</p>
          </div>
        </div>

        {/* Customers Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-bold text-slate-900">Customer Database</h3>
            <span className="text-xs font-bold text-slate-500 px-3 py-1 bg-white border border-slate-200 rounded-full">Showing Active</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-white border-b border-slate-100 text-xs uppercase font-bold text-slate-400">
                <tr>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Service</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                      Loading database...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-3">
                          <Users className="w-6 h-6" />
                        </div>
                        <h4 className="text-base font-bold text-slate-900 mb-1">No customers yet</h4>
                        <p className="text-sm text-slate-500 max-w-sm">Import your past customers via CSV to start requesting reviews automatically.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => (
                    <tr key={c._id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">{c.phone}</p>
                      </td>
                      <td className="px-6 py-4 font-medium">{c.service || '-'}</td>
                      <td className="px-6 py-4">
                        {c.optedOut ? (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600">Opted Out</span>
                        ) : c.reviewStatus === 'Completed' ? (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">Reviewed</span>
                        ) : c.reviewStatus === 'Requested' ? (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">In Campaign</span>
                        ) : (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Ready</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!c.optedOut && c.reviewStatus === 'Pending' && (
                          <button 
                            onClick={() => handleSendCampaign(c._id)}
                            disabled={sendingId === c._id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            {sendingId === c._id ? 'Starting...' : 'Request'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {showUpload && (
        <CustomerUploadModal 
          businessId={businessId} 
          tenantId={tenantId}
          onClose={() => setShowUpload(false)} 
          onSuccess={() => {
            setShowUpload(false);
            fetchCustomers(); // Refresh list after import
          }} 
        />
      )}
    </div>
  );
}
