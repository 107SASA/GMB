'use client';

import { useCallback, useEffect, useState } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import { CheckCircle2, Copy, Download, KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react';

interface Status { email: string; totpEnabled: boolean; totpEnabledAt: string | null; recoveryCodesLeft: number }

const input = 'w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-on-surface focus:outline-none focus:border-primary';
const btn = 'px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60';

async function call(action: string, code?: string) {
  const res = await fetch('/api/admin/account/two-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json.data;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Growwmatics AI super admin — recovery codes\nEach code works once. Keep them somewhere safe (not on the same phone).\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'growwmatics-admin-recovery-codes.txt'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-primary-fixed border border-primary-fixed-dim text-sm text-on-surface">
        <b>Save these 10 recovery codes now — they are shown only once.</b> If you lose your phone and email is also down,
        one of these gets you in. Each works once. Store them in a password manager or print them; not on the same phone.
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-base bg-surface-container rounded-xl p-4">
        {codes.map((c) => <span key={c} className="text-on-surface">{c}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={download} className={`${btn} flex items-center gap-1 bg-primary-fixed text-primary`}><Download className="w-4 h-4" /> Download .txt</button>
        <button onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); }} className={`${btn} flex items-center gap-1 bg-primary-fixed text-primary`}>
          <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={onDone} className={`${btn} bg-primary text-on-primary`}>I saved them</button>
      </div>
    </div>
  );
}

export default function TwoStepPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [manageCode, setManageCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/account/two-step');
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch { /* shown as loading */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyClientMessage(e, 'Something went wrong')); } finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-white" /></div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Two-step sign-in</h1>
          <p className="text-sm text-on-surface-variant">The second step after your password, for your own admin account.</p>
        </div>
      </div>

      {error && <div role="alert" className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container text-sm">{error}</div>}

      {!status ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : codes ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
          <RecoveryCodes codes={codes} onDone={() => { setCodes(null); load(); }} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Authenticator app */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <Smartphone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-on-surface">Authenticator app</div>
                  <p className="text-sm text-on-surface-variant">
                    Google Authenticator, Microsoft Authenticator or Authy. Works offline and does not depend on email, so a Resend outage can't lock you out.
                  </p>
                </div>
              </div>
              <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${status.totpEnabled ? 'bg-secondary-container/40 text-on-secondary-container' : 'bg-primary-fixed text-primary'}`}>
                {status.totpEnabled ? 'On' : 'Not set up'}
              </span>
            </div>

            {!status.totpEnabled && !setup && (
              <button disabled={busy} onClick={() => run(async () => { setSetup(await call('start')); setCode(''); })} className={`${btn} mt-4 bg-primary text-on-primary`}>
                Set up authenticator app
              </button>
            )}

            {!status.totpEnabled && setup && (
              <div className="mt-5 space-y-4">
                <ol className="text-sm text-on-surface space-y-1 list-decimal list-inside">
                  <li>Install <b>Google Authenticator</b> (or any authenticator app) on your phone.</li>
                  <li>In the app tap <b>+</b> → <b>Scan a QR code</b>, and scan this:</li>
                </ol>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <img src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} className="rounded-lg border border-outline-variant bg-white p-2" />
                  <div className="text-sm text-on-surface-variant">
                    Can't scan? Choose <b>Enter a setup key</b> and type:
                    <div className="mt-1 font-mono text-on-surface bg-surface-container rounded-lg px-3 py-2 break-all select-all">{setup.secret}</div>
                    <div className="mt-1 text-xs">Type: Time-based</div>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirm-code" className="block text-sm text-on-surface mb-1">3. Enter the 6-digit code the app shows</label>
                  <div className="flex gap-2">
                    <input id="confirm-code" className={`${input} max-w-40 text-center tracking-[0.3em] font-semibold`} inputMode="numeric" autoComplete="one-time-code"
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
                    <button disabled={busy || code.length !== 6} onClick={() => run(async () => { const d = await call('confirm', code); setSetup(null); setCodes(d.recoveryCodes); })}
                      className={`${btn} bg-primary text-on-primary`}>{busy ? 'Checking…' : 'Turn on'}</button>
                    <button onClick={() => setSetup(null)} className={`${btn} text-on-surface-variant`}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {status.totpEnabled && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-on-surface-variant flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-secondary" /> On since {new Date(status.totpEnabledAt!).toLocaleDateString()}. Sign-in asks for the app code first.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${input} max-w-52`} value={manageCode} onChange={(e) => setManageCode(e.target.value)} placeholder="Current app code" aria-label="Current code from the app" />
                  <button disabled={busy || manageCode.trim().length < 6} onClick={() => run(async () => { const d = await call('regenerate', manageCode.trim()); setManageCode(''); setCodes(d.recoveryCodes); })}
                    className={`${btn} bg-primary-fixed text-primary`}>New recovery codes</button>
                  <button disabled={busy || manageCode.trim().length < 6} onClick={() => run(async () => {
                    if (!window.confirm('Turn off the authenticator app? Sign-in will go back to email codes only.')) return;
                    await call('disable', manageCode.trim()); setManageCode(''); await load();
                  })} className={`${btn} text-error hover:bg-error-container`}>Turn off</button>
                </div>
                <p className="text-xs text-outline">New phone? Turn it off here (using a code from the old phone or a recovery code), then set it up again.</p>
              </div>
            )}
          </div>

          {/* Recovery codes */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 flex gap-3">
            <KeyRound className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-on-surface">Recovery codes</div>
              <p className="text-sm text-on-surface-variant">
                {status.totpEnabled
                  ? `${status.recoveryCodesLeft} of 10 left. Each works once, for when you have neither your phone nor your email.`
                  : 'You get 10 one-time codes when you turn on the authenticator app.'}
                {status.totpEnabled && status.recoveryCodesLeft <= 3 && <b className="text-primary"> Running low — make new ones.</b>}
              </p>
            </div>
          </div>

          {/* Email */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 flex gap-3">
            <CheckCircle2 className="w-5 h-5 text-secondary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-on-surface">Email code — {status.email}</div>
              <p className="text-sm text-on-surface-variant">
                {status.totpEnabled ? 'Backup: on the code screen, choose "Email me a code instead".' : 'Used at every sign-in until you set up the app.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
