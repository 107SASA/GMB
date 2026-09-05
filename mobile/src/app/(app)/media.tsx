import { useState } from 'react';

import { AppHeader } from '@/components/app-header';
import { LockedScreen } from '@/components/locked';
import { Screen, SegmentedControl } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import PhotosScreen from './photos/index';
import ReviewsScreen from './reviews/index';

type MediaTab = 'reviews' | 'photos';

/**
 * Combined "Media" tab — Photos and Reviews used to be two separate bottom
 * tabs; this merges them into one tab with a Reviews/Photos switch at the
 * top, freeing up a tab-bar slot for CRM (see leads/index.tsx, now shown
 * here too). The individual /reviews and /photos routes still exist
 * unchanged (still reachable from deep links elsewhere in the app, e.g.
 * dashboard quick links, notifications) — this screen just renders the same
 * two screen components embedded side by side, without duplicating them.
 *
 * Whole-tab lock: Photos itself has no plan gate, but Reviews is gated on
 * the Reviews & Reputation module — since they're one tab now, the WHOLE
 * tab (including Photos) shows the locked screen when that module isn't on
 * the plan, rather than only locking the Reviews half. Matches
 * reviews/_layout.tsx's own gate (same module, same check).
 */
export default function MediaScreen() {
  const locked = useSurfaceLocked('reviews');
  const [tab, setTab] = useState<MediaTab>('reviews');

  if (locked) return <LockedScreen surface="reviews" />;

  return (
    <Screen>
      <AppHeader title="Media" />
      <SegmentedControl
        segments={[
          { id: 'reviews', label: 'Reviews' },
          { id: 'photos', label: 'Photos' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'reviews' ? <ReviewsScreen embedded /> : <PhotosScreen embedded />}
    </Screen>
  );
}
