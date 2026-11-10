'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { renderReviewStandee } from '@/lib/reviewStandee';

/**
 * Google review QR code for the active workspace — the web version of the
 * mobile app's ReviewQrModal. Scanning it opens Google's own "write a review"
 * page for this listing (no search needed):
 *   https://search.google.com/local/writereview?placeid=<PLACE_ID>
 * Generated in the browser (no API call). Owners can copy the link, or
 * download / print the same Growwmatics AI-branded counter standee
 * (lib/reviewStandee.ts).
 */
export function reviewUrlFor(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export default function ReviewQrCard() {
  const { activeBusiness } = useBusiness();
  const placeId = activeBusiness?.googlePlaceId || activeBusiness?.placeId || null;
  const reviewUrl = placeId ? reviewUrlFor(placeId) : null;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQr(null);
    if (!reviewUrl) return;
    QRCode.toDataURL(reviewUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [reviewUrl]);

  const name = activeBusiness?.name || 'our business';

  const copy = async () => {
    if (!reviewUrl) return;
    try {
      await navigator.clipboard.writeText(reviewUrl);
      toast.success('Review link copied');
    } catch {
      toast.error('Could not copy — select the link and copy it manually.');
    }
  };

  // Download and Print share one branded standee design (lib/reviewStandee).
  const standeePng = async (): Promise<string | null> => {
    if (!reviewUrl) return null;
    try {
      const canvas = await renderReviewStandee({ businessName: name, reviewUrl });
      return canvas.toDataURL('image/png');
    } catch {
      toast.error('Could not create the QR standee — please try again.');
      return null;
    }
  };

  const download = async () => {
    const png = await standeePng();
    if (!png) return;
    const a = document.createElement('a');
    a.href = png;
    a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'google'}-review-qr-standee.png`;
    a.click();
  };

  const print = async () => {
    // Open the window synchronously (inside the click) so pop-up blockers allow it.
    const w = window.open('', '_blank', 'width=720,height=1000');
    if (!w) { toast.error('Allow pop-ups to print the poster.'); return; }
    const png = await standeePng();
    if (!png) { w.close(); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Review us on Google — ${esc(name)}</title>
      <style>
        @page{size:A5 portrait;margin:8mm}
        html,body{margin:0;background:#fff}
        body{display:flex;align-items:center;justify-content:center;min-height:100vh}
        img{display:block;max-width:100%;max-height:194mm;height:auto}
        @media screen{img{max-height:96vh}}
      </style></head><body>
        <img src="${png}" alt="Google review QR standee for ${esc(name)}" onload="setTimeout(function(){window.print()},50)"/>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
        <div className="w-36 h-36 shrink-0 rounded-xl border border-outline-variant bg-white flex items-center justify-center overflow-hidden self-center sm:self-auto">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Google review QR code" className="w-full h-full" />
          ) : (
            <MaterialIcon name="qr_code_2" size={48} className="text-outline" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-on-surface">Google review QR code</p>
          {reviewUrl ? (
            <>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Customers scan it and land straight on Google&apos;s review page for {name}. Put it on your counter, bills or packaging.
              </p>
              <p className="text-xs text-outline mt-2 break-all">{reviewUrl}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-outline-variant hover:bg-surface-container">
                  <MaterialIcon name="content_copy" size={14} /> Copy link
                </button>
                <button type="button" onClick={download} disabled={!qr} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-outline-variant hover:bg-surface-container disabled:opacity-50">
                  <MaterialIcon name="download" size={14} /> Download QR standee
                </button>
                <button type="button" onClick={print} disabled={!qr} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-container disabled:opacity-50">
                  <MaterialIcon name="print" size={14} /> Print poster
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-on-surface-variant mt-0.5">
              Connect your Google Business Profile (or add your Google listing in Settings) to get a review QR code.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
