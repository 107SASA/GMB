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
      case 'Confirmed': return 'bg-secondary-container text-on-secondary-container border-secondary-fixed';
      case 'Completed': return 'bg-primary-fixed text-primary border-primary-fixed-dim';
      case 'Pending': return 'bg-primary-fixed text-primary border-primary-fixed-dim';
      case 'Cancelled': 
      case 'No Show': return 'bg-error-container text-on-error-container border-error-container';
      case 'Rescheduled': return 'bg-primary-fixed text-primary border-primary-fixed-dim';
      default: return 'bg-surface-container text-on-surface border-outline-variant';
    }
  };

  if (loading) return <div className="p-10 text-center text-on-surface-variant">Loading Demo Pipeline...</div>;

  const pendingCount = bookings.filter(b => b.status === 'Pending').length;
  const upcomingCount = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Rescheduled').length;
  const completedCount = bookings.filter(b => b.status === 'Completed').length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-on-surface tracking-tight">Demo Pipeline</h1>
        <p className="text-on-surface-variant mt-1">Manage and convert inbound platform prospects.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase">Pending Review</p>
            <p className="text-3xl font-black text-on-surface mt-1">{pendingCount}</p>
          </div>
          <div className="w-12 h-12 bg-primary-fixed rounded-full flex items-center justify-center text-primary-fixed-dim">
            <Clock size={24} />
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase">Upcoming Demos</p>
            <p className="text-3xl font-black text-on-surface mt-1">{upcomingCount}</p>
          </div>
          <div className="w-12 h-12 bg-primary-fixed rounded-full flex items-center justify-center text-primary">
            <Calendar size={24} />
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase">Completed</p>
            <p className="text-3xl font-black text-on-surface mt-1">{completedCount}</p>
          </div>
          <div className="w-12 h-12 bg-secondary-container/40 rounded-full flex items-center justify-center text-secondary">
            <CheckCircle size={24} />
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-surface border-b border-outline-variant text-label-sm text-on-surface-variant">
          <div className="col-span-3">Prospect & Business</div>
          <div className="col-span-3">Contact</div>
          <div className="col-span-2">Scheduled For</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-outline-variant">
          {bookings.map((booking) => (
            <div key={booking._id} className="grid grid-cols-12 gap-4 px-6 py-5 items-center hover:bg-surface/50 transition-colors">
              
              <div className="col-span-3">
                <p className="font-bold text-on-surface text-sm">{booking.name}</p>
                <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-1">
                  <Building size={12} />
                  <span className="truncate">{booking.company} ({booking.businessType})</span>
                </div>
              </div>

              <div className="col-span-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <Mail size={14} className="text-outline" />
                  <span className="truncate">{booking.email}</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <Phone size={14} className="text-outline" />
                  <span>{booking.phone}</span>
                </div>
              </div>

              <div className="col-span-2">
                <p className="text-sm font-semibold text-on-surface">{new Date(booking.date).toLocaleDateString()}</p>
                <p className="text-xs font-medium text-on-surface-variant mt-0.5">{booking.timeSlot}</p>
              </div>

              <div className="col-span-2">
                <select 
                  value={booking.status}
                  onChange={(e) => handleStatusChange(booking._id, e.target.value)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${getStatusColor(booking.status)}`}
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
                  className="p-2 text-secondary hover:bg-secondary-container/40 rounded-lg transition-colors"
                  title="Confirm Demo"
                >
                  <CheckCircle size={18} />
                </button>
                <button 
                  onClick={() => handleStatusChange(booking._id, 'Cancelled')}
                  className="p-2 text-on-error-container hover:bg-error-container rounded-lg transition-colors"
                  title="Cancel Request"
                >
                  <XCircle size={18} />
                </button>
              </div>
              
            </div>
          ))}
          {bookings.length === 0 && (
            <div className="p-12 text-center text-on-surface-variant">
              No demo bookings found. 
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
