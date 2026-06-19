"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEV_CONTEXT } from "@/lib/dev-context";

interface Business {
  _id: string;
  name: string;
  category?: string;
  address?: string;
  userDefinedCategory?: string;
  googlePlaceId?: string;
  organizationId: string;
  googleConnected: boolean;
  whatsappConfig?: {
    isConnected: boolean;
    businessPhone?: string;
  };
  location?: {
    type: string;
    coordinates: number[];
  };
  website?: string;
  phone?: string;
}

interface BusinessContextType {
  businesses: Business[];
  activeBusiness: Business | null;
  loading: boolean;
  switchBusiness: (businessId: string) => Promise<void>;
}

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBusinesses = async () => {
    try {
      const res = await fetch('/api/business/all');
      const json = await res.json();
      if (json.success && json.businesses && json.businesses.length > 0) {
        setBusinesses(json.businesses);
        const activeId = json.activeBusinessId || json.businesses[0]._id;
        const active = json.businesses.find((b: any) => b._id === activeId) || json.businesses[0];
        setActiveBusiness(active);
      } else {
        // No businesses found
        setBusinesses([]);
        setActiveBusiness(null);
      }
    } catch (err) {
      console.error("Failed to load business context", err);
      setBusinesses([]);
      setActiveBusiness(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const switchBusiness = async (businessId: string) => {
    try {
      const res = await fetch('/api/business/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      if (res.ok) {
        const selected = businesses.find(b => b._id === businessId);
        if (selected) {
          setActiveBusiness(selected);
          router.refresh(); // Refresh the page to reload SSR components with new cookie
        }
      }
    } catch (err) {
      console.error('Failed to switch business', err);
    }
  };

  return (
    <BusinessContext.Provider value={{ businesses, activeBusiness, loading, switchBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error("useBusiness must be used within a BusinessProvider");
  }
  return context;
}
