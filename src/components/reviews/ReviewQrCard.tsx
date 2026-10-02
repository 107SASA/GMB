'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/**
 * Google review QR code for the active workspace — the web version of the
 * mobile app's ReviewQrModal. Scanning it opens Google's own "write a review"
 * page for this listing (no search needed):
 *   https://search.google.com/local/writereview?placeid=<PLACE_ID>
 * Generated in the browser (no API call). Owners can copy the link, download
 * the QR as a PNG, or print a counter poster.
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

  const download = () => {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'google'}-review-qr.png`;
    a.click();
  };

  const print = () => {
    if (!qr) return;
    const w = window.open('', '_blank', 'width=720,height=960');
    if (!w) { toast.error('Allow pop-ups to print the poster.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Review us on Google — ${esc(name)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;color:#1f2937}
        .p{text-align:center;padding:40px;border:2px solid #e5e7eb;border-radius:24px;max-width:520px}
        h1{font-size:30px;margin:0 0 6px} h2{font-size:22px;margin:0 0 24px;font-weight:600;color:#4b5563}
        img{width:340px;height:340px} p{font-size:16px;color:#4b5563;margin:20px 0 0}
        .g{font-weight:700} .g span:nth-child(1),.g span:nth-child(4){color:#4285F4}.g span:nth-child(2),.g span:nth-child(6){color:#EA4335}.g span:nth-child(3){color:#FBBC05}.g span:nth-child(5){color:#34A853}
      </style></head><body><div class="p">
        <h1>Loved your visit?</h1><h2>Review ${esc(name)} on <span class="g"><span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span></span></h2>
        <img src="${qr}" alt="Google review QR code"/>
        <p>Scan with your phone camera — it opens our Google review page.</p>
      </div><script>window.onload=()=>{window.print()}</script></body></html>`);
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
                  <MaterialIcon name="download" size={14} /> Download QR
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
