'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ShowcaseItem {
  id: string;
  mediaType: 'photo' | 'video';
  url: string;
  caption: string | null;
  businessName: string | null;
  publishedAt: string;
}

interface TestimonialItem {
  id: string;
  reviewerName: string;
  rating: number;
  reviewText: string;
  photoUrl: string | null;
  businessName: string | null;
  reviewedAt: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <MaterialIcon
          key={s}
          name="star"
          size={16}
          filled={s <= rating}
          className={s <= rating ? 'text-[#f5b400]' : 'text-[#d8dfd6]'}
        />
      ))}
    </span>
  );
}

export function ShowcasePage() {
  const [media, setMedia] = useState<ShowcaseItem[] | null>(null);
  const [reviews, setReviews] = useState<TestimonialItem[] | null>(null);

  useEffect(() => {
    fetch('/api/public/showcase')
      .then((r) => r.json())
      .then((json) => setMedia(json.success ? json.items : []))
      .catch(() => setMedia([]));
    fetch('/api/public/testimonials')
      .then((r) => r.json())
      .then((json) => setReviews(json.success ? json.items : []))
      .catch(() => setReviews([]));
  }, []);

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#101613] font-medium">Showcase</span>
        </nav>
      </div>

      <section className="relative pt-10 pb-6 px-6 max-w-4xl mx-auto text-center">
        <h1 className="font-mkt-display text-3xl md:text-5xl font-bold text-[#101613] mb-6 leading-[1.15]">
          Real businesses, real results
        </h1>
        <p className="text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
          Photos, clips, and reviews shared directly by businesses on GrowwMatics — every one reviewed by our team before it's posted here.
        </p>
      </section>

      {/* Photos & videos */}
      <section className="px-6 pb-8 max-w-6xl mx-auto">
        {media === null ? (
          <p className="text-center text-[#3d4a3d] py-16">Loading…</p>
        ) : media.length === 0 ? (
          <p className="text-center text-[#3d4a3d] py-10">No photos or videos yet — check back soon.</p>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 [column-fill:_balance]">
            {media.map((item) => (
              <div key={item.id} className="mb-5 break-inside-avoid rounded-2xl overflow-hidden border border-(--mkt-ink-border) bg-white/40">
                {item.mediaType === 'video' ? (
                  <video src={item.url} controls className="w-full h-auto" />
                ) : (
                  <img src={item.url} alt={item.caption || 'Customer showcase'} className="w-full h-auto" />
                )}
                {(item.caption || item.businessName) && (
                  <div className="p-4">
                    {item.caption && <p className="text-sm text-[#101613]">{item.caption}</p>}
                    {item.businessName && <p className="text-xs text-[#3d4a3d] mt-1 font-semibold">{item.businessName}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Testimonials */}
      <section className="px-6 pb-24 max-w-6xl mx-auto">
        <h2 className="font-mkt-display text-2xl md:text-3xl font-bold text-[#101613] mb-8 text-center">
          What our clients say
        </h2>
        {reviews === null ? (
          <p className="text-center text-[#3d4a3d] py-10">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="text-center text-[#3d4a3d] py-10">No reviews yet — check back soon.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-2xl border border-(--mkt-ink-border) bg-white p-5">
                <Stars rating={r.rating} />
                <p className="text-sm text-[#101613] mt-3 leading-relaxed">&ldquo;{r.reviewText}&rdquo;</p>
                <div className="flex items-center gap-3 mt-4">
                  {r.photoUrl ? (
                    <img src={r.photoUrl} alt={r.reviewerName || 'Reviewer'} className="w-9 h-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center font-bold text-sm shrink-0">
                      {r.reviewerName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#101613] truncate">{r.reviewerName || 'A GrowwMatics client'}</p>
                    {r.businessName && <p className="text-xs text-[#3d4a3d] truncate">{r.businessName}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
