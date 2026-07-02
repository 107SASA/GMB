'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Building, Mail, Phone, Clock, ChevronDown, CheckCircle, XCircle } from 'lucide-react';

export default function AdminDemoBookingsPage() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = async () => {
    try {
      const res = await fetch('/api/admin/demo-bookings');
      const data = await res.json();
      if (data.success) {
        setBookings(data.bookings);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleStatusChange = async (bookingId: string, status: string) => {
    try {
      const res = await fetch('/api/admin/demo-bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status })
      });
      if (res.ok) fetchBookings();
    } catch (e) {
      console.error(e);
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Confirmed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Completed': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Cancelled': 
      case 'No Show': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'Rescheduled': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-500">Loading Demo Pipeline...</div>;

  const pendingCount = bookings.filter(b => b.status === 'Pending').length;
  const upcomingCount = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Rescheduled').length;
  const completedCount = bookings.filter(b => b.status === 'Completed').length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Demo Pipeline</h1>
        <p className="text-slate-500 mt-1">Manage and convert inbound platform prospects.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase">Pending Review</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{pendingCount}</p>
          </div>
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-500">
            <Clock size={24} />
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase">Upcoming Demos</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{upcomingCount}</p>
          </div>
          <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-500">
            <Calendar size={24} />
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase">Completed</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{completedCount}</p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500">
            <CheckCircle size={24} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-3">Prospect & Business</div>
          <div className="col-span-3">Contact</div>
          <div className="col-span-2">Scheduled For</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-slate-100">
          {bookings.map((booking) => (
            <div key={booking._id} className="grid grid-cols-12 gap-4 px-6 py-5 items-center hover:bg-slate-50/50 transition-colors">
              
              <div className="col-span-3">
                <p className="font-bold text-slate-900 text-sm">{booking.name}</p>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <Building size={12} />
                  <span className="truncate">{booking.company} ({booking.businessType})</span>
                </div>
              </div>

              <div className="col-span-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail size={14} className="text-slate-400" />
                  <span className="truncate">{booking.email}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone size={14} className="text-slate-400" />
                  <span>{booking.phone}</span>
                </div>
              </div>

              <div className="col-span-2">
                <p className="text-sm font-semibold text-slate-900">{new Date(booking.date).toLocaleDateString()}</p>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{booking.timeSlot}</p>
              </div>

              <div className="col-span-2">
                <select 
                  value={booking.status}
                  onChange={(e) => handleStatusChange(booking._id, e.target.value)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-100 ${getStatusColor(booking.status)}`}
                >
                  <option value="Pending">Pending Review</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Rescheduled">Rescheduled</option>
                  <option value="Completed">Completed</option>
                  <option value="No Show">No Show</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="col-span-2 flex justify-end gap-2">
                <button 
                  onClick={() => handleStatusChange(booking._id, 'Confirmed')}
                  className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                  title="Confirm Demo"
                >
                  <CheckCircle size={18} />
                </button>
                <button 
                  onClick={() => handleStatusChange(booking._id, 'Cancelled')}
                  className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Cancel Request"
                >
                  <XCircle size={18} />
                </button>
              </div>
              
            </div>
          ))}
          {bookings.length === 0 && (
            <div className="p-12 text-center text-slate-500">
              No demo bookings found. 
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
