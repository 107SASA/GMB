import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { getApiErrorMessage } from '@/api/client';
import { uploadGbpMedia } from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { useConfirmSheet, useInfoSheet } from '@/components/ui';
import { recoverPendingCapture, videoProblem } from '@/lib/photoLocation';

/**
 * Android only: if the system closed the app while the camera was open, the
 * photo / video comes back on the next start. Upload it the normal way (same
 * endpoint, same location handling) so a capture is never silently lost, and
 * tell the owner where it went. Mounted once inside the signed-in app.
 */
export function PendingCaptureRecovery() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const router = useRouter();
  const info = useInfoSheet();
  const confirm = useConfirmSheet();
  const ran = useRef(false);

  useEffect(() => {
    if (!activeBusinessId || ran.current) return;
    ran.current = true;
    void (async () => {
      const rec = await recoverPendingCapture();
      if (!rec) return;
      const label = rec.kind === 'video' ? 'video' : 'photo';
      if (rec.kind === 'video') {
        const problem = videoProblem(rec.picked);
        if (problem) {
          info.show('Video not uploaded', problem);
          return;
        }
      }
      try {
        await uploadGbpMedia({ uri: rec.picked.uri, mimeType: rec.picked.mimeType, fileName: rec.picked.fileName, category: 'ADDITIONAL', location: rec.picked.location });
        void queryClient.invalidateQueries({ queryKey: ['gbp-media', activeBusinessId] });
        confirm.confirm({
          title: `Your ${label} was saved`,
          message: `The ${label} you just took is in Photos & Videos. It's not on Google yet — open it to publish or schedule it.`,
          confirmLabel: 'Open Photos & Videos',
          cancelLabel: 'Later',
          onConfirm: () => router.push('/photos/all' as never),
        });
      } catch (err) {
        info.show('Upload failed', getApiErrorMessage(err, `The ${label} you took could not be uploaded. Please try again.`));
      }
    })();
  }, [activeBusinessId, queryClient, router, info, confirm]);

  return (
    <>
      {info.node}
      {confirm.node}
    </>
  );
}
