'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X, Database } from 'lucide-react';

export default function AuditDebugPanel({ auditData }: { auditData: any }) {
  const [isOpen, setIsOpen] = useState(false);

  // Only render in development mode
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  if (!auditData) return null;

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 p-4 bg-primary text-white rounded-full card-shadow hover:bg-primary transition-colors flex items-center justify-center group"
      >
        <Bug className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap group-hover:ml-3 group-hover:pr-2 font-mono text-sm font-bold">
          Data Flow Debugger
        </span>
      </button>

      {/* Debug Panel Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-4xl max-h-[85vh] flex flex-col border border-outline-variant overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-fixed text-primary rounded-lg">
                    <Database className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-bold text-on-surface font-mono">
                    Audit Engine Data Flow
                  </h2>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 text-outline hover:text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-surface">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Database Traces */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-on-surface uppercase text-xs tracking-wider">
                      Business DB Record
                    </h3>
                    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant font-mono text-sm overflow-x-auto">
                      <pre className="text-on-surface">
                        {JSON.stringify({
                          businessName: auditData.businessName,
                          location: auditData.location,
                          googlePlaceId: auditData.metadata?.googlePlaceId || 'MISSING',
                          userDefinedCategory: auditData.metadata?.userDefinedCategory || 'MISSING',
                          coordinates: auditData.metadata?.coordinates || 'MISSING',
                          gbpUrl: auditData.gbpUrl,
                        }, null, 2)}
                      </pre>
                    </div>

                    <h3 className="font-bold text-on-surface uppercase text-xs tracking-wider pt-4">
                      Real Metrics Engine
                    </h3>
                    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant font-mono text-sm overflow-x-auto">
                      <pre className="text-on-surface">
                        {JSON.stringify({
                          calculatedProfileScore: auditData.realMetrics?.calculatedProfileScore,
                          calculatedEngagementScore: auditData.realMetrics?.calculatedEngagementScore,
                          totalReviews: auditData.realMetrics?.reviewsCount,
                          photosCount: auditData.realMetrics?.hasPhotos ? 'Yes' : 'No',
                          reviewsPerWeek: auditData.realMetrics?.reviewsPerWeek,
                          responseRate: auditData.realMetrics?.responseRate,
                        }, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* AI & Competitors */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-on-surface uppercase text-xs tracking-wider">
                      SERPAPI & Google Places
                    </h3>
                    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant font-mono text-sm overflow-x-auto">
                      <p className="text-xs text-on-surface-variant mb-2 font-sans border-b pb-2">
                        Found {auditData.competitors?.length || 0} competitors
                      </p>
                      <pre className="text-on-surface">
                        {JSON.stringify(auditData.competitors?.map((c: any) => c.name), null, 2)}
                      </pre>
                      <p className="text-xs text-on-surface-variant mb-2 font-sans border-b pb-2 mt-4">
                        Found {auditData.realMetrics?.keywordRankings?.length || 0} live keyword rankings
                      </p>
                      <pre className="text-on-surface">
                        {JSON.stringify(auditData.realMetrics?.keywordRankings, null, 2)}
                      </pre>
                    </div>

                    <h3 className="font-bold text-on-surface uppercase text-xs tracking-wider pt-4">
                      Competitor Discovery Engine
                    </h3>
                    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant font-mono text-sm overflow-x-auto">
                      <pre className="text-on-surface">
                        {JSON.stringify({
                          businessName: auditData.metadata?.debug?.businessName,
                          category: auditData.metadata?.debug?.category,
                          area: auditData.metadata?.debug?.area,
                          city: auditData.metadata?.debug?.city,
                          reviewCount: auditData.metadata?.debug?.reviewCount,
                          tier: auditData.metadata?.debug?.tier,
                          competitorsFound: auditData.metadata?.debug?.competitorsFound?.map((c: any) => c.name) || [],
                          competitorsRejected: auditData.metadata?.debug?.competitorsRejected?.map((r: any) => ({ name: r.competitor?.name, reason: r.reason })) || [],
                        }, null, 2)}
                      </pre>
                    </div>

                    <h3 className="font-bold text-on-surface uppercase text-xs tracking-wider pt-4">
                      AI Generated Output
                    </h3>
                    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant font-mono text-sm overflow-x-auto">
                      <pre className="text-on-surface">
                        {JSON.stringify({
                          keywordsUsed: auditData.auditData?.keywords,
                          overallScore: auditData.overallScore,
                          status: auditData.status,
                        }, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
