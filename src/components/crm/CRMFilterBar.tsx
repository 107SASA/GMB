import { Search, Filter } from 'lucide-react';

interface CRMFilterBarProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  sourceFilter: string;
  setSourceFilter: (val: string) => void;
  statusFilter: string;
  setStatusFilter: (val: string) => void;
}

export default function CRMFilterBar({
  searchQuery,
  setSearchQuery,
  sourceFilter,
  setSourceFilter,
  statusFilter,
  setStatusFilter
}: CRMFilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm items-center">
      <div className="relative flex-1 w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search leads by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
        />
      </div>
      
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        >
          <option value="all">All Sources</option>
          <option value="Google Business Profile">Google Business Profile</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="Website">Website</option>
          <option value="Manual">Manual</option>
          <option value="Instagram">Instagram</option>
          <option value="Facebook">Facebook</option>
          <option value="Referral">Referral</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
    </div>
  );
}
