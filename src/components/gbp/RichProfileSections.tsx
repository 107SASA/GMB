'use client';

/**
 * Profile optimization sections Google offers only to some listings:
 *  - Menu (restaurants, cafés…): photo → AI reads the dishes → owner checks → approve
 *  - Hotel details (lodging): pre-ticked from their own text / website → approve
 *  - Booking / order buttons: pre-filled from their website's booking page → approve
 * Every save is a proposal (POST /api/gbp/changes) — nothing reaches Google
 * until the owner applies it under "Ready to apply".
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

type Spice = 'MILD' | 'MEDIUM' | 'HOT';
interface MenuItem { name: string; description?: string; price: number | null; veg?: boolean | null; spice?: Spice | null; serves?: number | null }
interface MenuSection { name: string; items: MenuItem[] }
interface MenuDraft { currency: string; sections: MenuSection[] }

type PanelProps = { title: string; hint?: string; section?: string; children: ReactNode };

interface Props {
  recs: any;
  busy: boolean;
  propose: (body: object, onSaved?: () => void) => Promise<void> | void;
  setMessage: (m: string | null) => void;
  Panel: (p: PanelProps) => ReactNode;
}

const btnPrimary = 'px-3.5 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-50';
const btnOutline = 'px-3.5 py-1.5 rounded-lg border border-outline text-sm font-bold disabled:opacity-50';
const input = 'border border-outline-variant rounded-lg px-2.5 py-1.5 text-sm bg-transparent';

const dishCount = (d: MenuDraft | null) => (d ? d.sections.reduce((n, s) => n + s.items.length, 0) : 0);

export default function RichProfileSections(props: Props) {
  return (
    <>
      {props.recs?.foodMenu?.allowed && <MenuSectionPanel {...props} />}
      {props.recs?.lodging?.allowed && <HotelPanel {...props} />}
      {props.recs?.buttons?.types?.length > 0 && <ButtonsPanel {...props} />}
      {props.recs?.connected !== false && <ProductsPanel {...props} />}
    </>
  );
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function MenuSectionPanel({ recs, busy, propose, setMessage, Panel }: Props) {
  const current: MenuDraft | null = recs.foodMenu?.current ?? null;
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [reading, setReading] = useState(false);

  const scan = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    setMessage(null);
    try {
      const form = new FormData();
      Array.from(files).slice(0, 4).forEach((f) => form.append('photos', f));
      const res = await fetch('/api/gbp/menu/scan', { method: 'POST', body: form });
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error || 'We couldn’t read the menu. Please try again.');
        return;
      }
      setDraft(json.draft);
      setMessage(`Read ${json.found} dish${json.found === 1 ? '' : 'es'} from your photo${files.length > 1 ? 's' : ''}${json.added ? ` — ${json.added} new` : ''}.${json.missingPrices ? ` ${json.missingPrices} need a price before Google will accept them.` : ''} Check them below, then save.`);
    } catch {
      setMessage('We couldn’t read the menu. Please try again.');
    } finally {
      setReading(false);
    }
  };

  const update = (si: number, ii: number, patch: Partial<MenuItem>) => setDraft((d) => d && {
    ...d,
    sections: d.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) })),
  });
  const removeItem = (si: number, ii: number) => setDraft((d) => d && {
    ...d,
    sections: d.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.filter((_, j) => j !== ii) })).filter((s) => s.items.length > 0),
  });
  const addItem = (si: number) => setDraft((d) => d && {
    ...d,
    sections: d.sections.map((s, i) => (i !== si ? s : { ...s, items: [...s.items, { name: '', price: null, veg: null }] })),
  });

  const missing = draft ? draft.sections.flatMap((s) => s.items).filter((i) => i.name.trim() && i.price == null).length : 0;
  const hint = draft ? `${dishCount(draft)} dishes — not saved` : current ? `${dishCount(current)} dishes on Google` : 'No menu yet';

  return (
    <Panel section="menu" title="Menu" hint={hint}>
      {!recs.foodMenu.readable && <p className="text-xs text-on-surface-variant">We couldn’t read your current menu from Google right now. A new menu replaces it.</p>}
      {!draft && (
        <>
          <p className="text-sm text-on-surface-variant">
            {current
              ? `Your Google menu has ${dishCount(current)} dishes in ${current.sections.length} section${current.sections.length === 1 ? '' : 's'}. Upload your latest menu and we’ll add the new dishes.`
              : 'Customers check the menu before they visit. Take a photo of your menu — we’ll read every dish and price for you.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btnPrimary} cursor-pointer ${reading || busy ? 'pointer-events-none opacity-50' : ''}`}>
              {reading ? 'Reading your menu…' : 'Upload menu photos'}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={reading || busy} onChange={(e) => { scan(e.target.files); e.target.value = ''; }} />
            </label>
            {current && <button type="button" className={btnOutline} disabled={busy} onClick={() => setDraft(current)}>Edit current menu</button>}
          </div>
          <p className="text-xs text-on-surface-variant">Up to 4 clear photos (all pages). Nothing goes to Google until you approve it.</p>
        </>
      )}

      {draft && (
        <div className="space-y-4">
          {draft.sections.map((s, si) => (
            <div key={si} className="space-y-1.5">
              <input
                className={`${input} w-full font-semibold`}
                value={s.name}
                aria-label="Section name"
                onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)) })}
              />
              {s.items.map((it, ii) => (
                <div key={ii} className="flex flex-wrap items-center gap-1.5">
                  <input className={`${input} min-w-0 flex-1`} value={it.name} placeholder="Dish name" aria-label="Dish name" onChange={(e) => update(si, ii, { name: e.target.value })} />
                  <input
                    className={`${input} w-24 ${it.price == null && it.name.trim() ? 'border-error' : ''}`}
                    inputMode="decimal"
                    placeholder="Price"
                    aria-label="Price"
                    value={it.price ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '');
                      update(si, ii, { price: v === '' ? null : Number(v) });
                    }}
                  />
                  <button
                    type="button"
                    title="Vegetarian?"
                    onClick={() => update(si, ii, { veg: it.veg === true ? false : it.veg === false ? null : true })}
                    className={`rounded-md border px-2 py-1 text-xs ${it.veg === true ? 'border-green-600 text-green-700' : it.veg === false ? 'border-red-700 text-red-700' : 'border-outline-variant text-on-surface-variant'}`}
                  >{it.veg === true ? 'Veg' : it.veg === false ? 'Non-veg' : 'Veg?'}</button>
                  <button type="button" aria-label={`Remove ${it.name}`} className="px-1.5 text-on-surface-variant hover:text-error" onClick={() => removeItem(si, ii)}>✕</button>
                </div>
              ))}
              <button type="button" className="text-xs font-semibold text-primary" onClick={() => addItem(si)}>+ Add dish</button>
            </div>
          ))}
          <button type="button" className="text-xs font-semibold text-primary" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { name: 'New section', items: [{ name: '', price: null, veg: null }] }] })}>+ Add section</button>
          {missing > 0 && <p className="text-xs text-error">Google needs a price for every dish — {missing} still missing.</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || missing > 0 || dishCount(draft) === 0}
              onClick={() => propose({
                kind: 'food_menu',
                source: 'owner',
                proposed: { draft: { ...draft, sections: draft.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.name.trim()) })) } },
              }, () => setDraft(null))}
            >Save menu ({dishCount(draft)} dishes)</button>
            <label className={`${btnOutline} cursor-pointer ${reading || busy ? 'pointer-events-none opacity-50' : ''}`}>
              {reading ? 'Reading…' : 'Add more photos'}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { scan(e.target.files); e.target.value = ''; }} />
            </label>
            <button type="button" className="px-2 text-sm text-on-surface-variant" onClick={() => setDraft(null)}>Cancel</button>
          </div>
          <p className="text-xs text-on-surface-variant">Saving replaces the menu on Google with this one. Photos and options you added in Google for a dish stay.</p>
        </div>
      )}
    </Panel>
  );
}

// ─── Hotel details ────────────────────────────────────────────────────────────

function HotelPanel({ recs, busy, propose, Panel }: Props) {
  const lodging = recs.lodging;
  const fields: Array<{ path: string; label: string; group: string; type: 'bool' | 'time' }> = lodging.fields || [];
  const initial = useMemo(() => {
    const v: Record<string, boolean | string | null> = { ...(lodging.current || {}) };
    for (const p of lodging.suggested || []) if (v[p] == null) v[p] = true;
    return v;
  }, [lodging]);
  const [values, setValues] = useState<Record<string, boolean | string | null>>(initial);
  useEffect(() => setValues(initial), [initial]);

  const changed = Object.keys(values).filter((p) => (values[p] ?? null) !== (lodging.current?.[p] ?? null) && values[p] !== null);
  const groups = [...new Set(fields.map((f) => f.group))];
  const suggested = new Set<string>(lodging.suggested || []);

  if (!lodging.readable) {
    return (
      <Panel section="hotel" title="Hotel details" hint="Unavailable">
        <p className="text-sm text-on-surface-variant">We couldn’t read your hotel details from Google right now. Please try again later.</p>
      </Panel>
    );
  }
  return (
    <Panel section="hotel" title="Hotel details" hint={changed.length ? `${changed.length} to update` : 'Up to date'}>
      <p className="text-xs text-on-surface-variant">
        Guests filter hotels by these on Google.{suggested.size ? ' We ticked the ones your website and description mention — untick any you don’t have.' : ''}
      </p>
      {groups.map((g) => (
        <div key={g} className="space-y-1.5">
          <p className="text-xs font-semibold text-on-surface">{g}</p>
          <div className="flex flex-wrap gap-2">
            {fields.filter((f) => f.group === g).map((f) => f.type === 'time' ? (
              <label key={f.path} className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                {f.label}
                <input type="time" className={input} value={String(values[f.path] ?? '')} onChange={(e) => setValues({ ...values, [f.path]: e.target.value || null })} />
              </label>
            ) : (
              <button
                key={f.path}
                type="button"
                aria-pressed={values[f.path] === true}
                onClick={() => setValues({ ...values, [f.path]: values[f.path] === true ? (lodging.current?.[f.path] === true ? false : (lodging.current?.[f.path] ?? null)) : true })}
                className={`rounded-full border px-3 py-1 text-xs ${values[f.path] === true ? 'border-primary bg-primary-fixed/40 text-on-surface' : 'border-outline-variant text-on-surface-variant'}`}
              >
                {values[f.path] === true ? '✓ ' : ''}{f.label}{suggested.has(f.path) && lodging.current?.[f.path] == null ? ' •' : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        className={btnPrimary}
        disabled={busy || !changed.length}
        onClick={() => propose({ kind: 'lodging', source: suggested.size ? 'recommendation' : 'owner', proposed: Object.fromEntries(changed.map((p) => [p, values[p]])) })}
      >Save {changed.length || ''} hotel detail{changed.length === 1 ? '' : 's'}</button>
    </Panel>
  );
}

// ─── Booking / order buttons ──────────────────────────────────────────────────

function ButtonsPanel({ recs, busy, propose, Panel }: Props) {
  const types: Array<{ placeActionType: string; label: string; current: string | null; partner: string | null; suggested: string | null }> = recs.buttons.types;
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    setLinks(Object.fromEntries(types.map((t) => [t.placeActionType, t.current || t.suggested || ''])));
  }, [types]);
  const missing = types.filter((t) => !t.current && !t.partner).length;

  return (
    <Panel section="buttons" title="Booking & order buttons" hint={missing ? `${missing} not set` : 'All set'}>
      <p className="text-xs text-on-surface-variant">These buttons appear on your Google profile so customers can book or order in one tap.</p>
      {types.map((t) => {
        const value = links[t.placeActionType] ?? '';
        const unchanged = value.trim() === (t.current || '');
        return (
          <div key={t.placeActionType} className="space-y-1">
            <p className="text-sm font-medium text-on-surface">{t.label}</p>
            {t.partner && !t.current && <p className="text-xs text-on-surface-variant">A booking partner already provides this button. Add your own link only if you want customers to use it instead.</p>}
            {!t.current && t.suggested && <p className="text-xs text-on-surface-variant">Found on your website — check it’s the right page.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="https://your-booking-page.com"
                value={value}
                onChange={(e) => setLinks({ ...links, [t.placeActionType]: e.target.value })}
              />
              <button
                type="button"
                className={btnOutline}
                disabled={busy || !value.trim() || unchanged}
                onClick={() => propose({ kind: 'place_action', source: !t.current && value === t.suggested ? 'recommendation' : 'owner', proposed: { placeActionType: t.placeActionType, uri: value.trim() } })}
              >{t.current ? 'Update' : 'Add button'}</button>
              {t.current && (
                <button type="button" className="px-2 text-sm text-on-surface-variant hover:text-error" disabled={busy} onClick={() => propose({ kind: 'place_action', source: 'owner', proposed: { placeActionType: t.placeActionType, uri: null } })}>Remove</button>
              )}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

// ─── Products ─────────────────────────────────────────────────────────────────

type ButtonType = 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'CALL';
interface ProductDraft { imageUrl: string | null; name: string; category: string; description: string; price: number | null; button: ButtonType; buttonUrl: string; source: string }
interface ProductRow { _id: string; name: string; price: number | null; imageUrl?: string; lastPostedAt?: string; scheduledPostAt?: string; postCount?: number }

const BUTTON_TEXT: Record<ButtonType, string> = { ORDER: 'Order online', SHOP: 'Buy', LEARN_MORE: 'Learn more', CALL: 'Call now' };

function when(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function ProductsPanel({ busy, setMessage, Panel }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [autoPost, setAutoPost] = useState(false);
  const [website, setWebsite] = useState('');
  const [drafts, setDrafts] = useState<ProductDraft[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const reload = async () => {
    const json = await fetch('/api/products').then((r) => r.json()).catch(() => null);
    if (json?.success) {
      setProducts(json.products || []);
      setAutoPost(!!json.autoPost);
      setWebsite(json.website || '');
    }
  };
  useEffect(() => { reload(); }, []);

  const scan = async (files: FileList | null) => {
    if (!files?.length) return;
    setWorking('scan');
    setMessage(null);
    try {
      const form = new FormData();
      Array.from(files).slice(0, 10).forEach((f) => form.append('photos', f));
      const json = await fetch('/api/products/scan', { method: 'POST', body: form }).then((r) => r.json());
      if (!json.success) { setMessage(json.error || 'We couldn’t read these photos.'); return; }
      const defaultButton: ButtonType = /^https:/i.test(website) ? 'SHOP' : 'CALL';
      setDrafts([...(drafts || []), ...json.drafts.map((d: any) => ({ ...d, button: defaultButton, buttonUrl: '' }))]);
      setMessage(json.unread ? `${json.unread} photo${json.unread === 1 ? '' : 's'} couldn’t be read — please type the name.` : 'We filled in the details from your photos. Check them, then save.');
    } finally {
      setWorking(null);
    }
  };

  const save = async (post: boolean) => {
    if (!drafts?.length) return;
    setWorking(post ? 'post' : 'save');
    setMessage(null);
    try {
      const json = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post, items: drafts.map((d) => ({ ...d, buttonUrl: d.buttonUrl.trim() || undefined })) }),
      }).then((r) => r.json());
      if (!json.success) { setMessage(json.error || 'Couldn’t save the products.'); return; }
      setDrafts(null);
      const p = json.posting;
      setMessage(post && p
        ? `Saved ${json.products.length} product${json.products.length === 1 ? '' : 's'}. ${p.scheduled ? `They’ll be posted on Google one at a time${p.first ? `, starting ${when(p.first)}` : ''}.` : ''} We’ll keep posting one product a week so your profile stays fresh.`
        : `Saved ${json.products.length} product${json.products.length === 1 ? '' : 's'}.`);
      await reload();
    } finally {
      setWorking(null);
    }
  };

  const postNow = async (ids: string[] | 'all') => {
    setWorking('post');
    try {
      const json = await fetch('/api/products/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then((r) => r.json());
      setMessage(json.success
        ? json.posting.scheduled ? `${json.posting.scheduled} product post${json.posting.scheduled === 1 ? '' : 's'} scheduled${json.posting.first ? ` from ${when(json.posting.first)}` : ''}.${json.posting.skipped ? ` ${json.posting.skipped} were posted recently, so we skipped them.` : ''}` : 'These were posted recently — nothing new to post yet.'
        : json.error || 'Couldn’t schedule the posts.');
      await reload();
    } finally {
      setWorking(null);
    }
  };

  const toggleAuto = async () => {
    const next = !autoPost;
    setAutoPost(next);
    await fetch('/api/products/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPost: next }) }).catch(() => setAutoPost(!next));
  };

  const remove = async (id: string) => {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    await reload();
  };

  const edit = (i: number, patch: Partial<ProductDraft>) => setDrafts((d) => d && d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const disabled = busy || !!working;
  const hint = drafts ? `${drafts.length} not saved` : products.length ? `${products.length} product${products.length === 1 ? '' : 's'}` : 'Add your products';

  return (
    <Panel section="products" title="Products" hint={hint}>
      <p className="text-xs text-on-surface-variant">
        Take photos of what you sell — we write the name and details, then post each product on your Google profile with its photo, price and a button.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btnPrimary} cursor-pointer ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          {working === 'scan' ? 'Reading photos…' : drafts ? 'Add more photos' : 'Upload product photos'}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={disabled} onChange={(e) => { scan(e.target.files); e.target.value = ''; }} />
        </label>
        <span className="text-xs text-on-surface-variant">One product per photo, up to 10 at a time.</span>
      </div>

      {drafts && (
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-outline-variant p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote product photo (Spaces), thumbnail only */}
              {d.imageUrl && <img src={d.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <input className={`${input} min-w-0 flex-1`} placeholder="Product name" value={d.name} onChange={(e) => edit(i, { name: e.target.value })} />
                  <input className={`${input} w-28`} inputMode="decimal" placeholder="Price (optional)" value={d.price ?? ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); edit(i, { price: v === '' ? null : Number(v) }); }} />
                </div>
                <textarea className={`${input} w-full`} rows={2} placeholder="Short description" value={d.description} onChange={(e) => edit(i, { description: e.target.value })} />
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <select className={input} value={d.button} onChange={(e) => edit(i, { button: e.target.value as ButtonType })}>
                    {(Object.keys(BUTTON_TEXT) as ButtonType[]).map((b) => <option key={b} value={b}>Button: {BUTTON_TEXT[b]}</option>)}
                  </select>
                  {d.button !== 'CALL' && (
                    <input className={`${input} min-w-0 flex-1`} placeholder={website ? `Link (default: ${website})` : 'https://… page for this product'} value={d.buttonUrl} onChange={(e) => edit(i, { buttonUrl: e.target.value })} />
                  )}
                  <button type="button" className="px-1.5 text-on-surface-variant hover:text-error" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Remove</button>
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={disabled || drafts.some((d) => d.name.trim().length < 2)} onClick={() => save(true)}>
              {working === 'post' ? 'Saving…' : `Save & post ${drafts.length} to Google`}
            </button>
            <button type="button" className={btnOutline} disabled={disabled || drafts.some((d) => d.name.trim().length < 2)} onClick={() => save(false)}>Save only</button>
            <button type="button" className="px-2 text-sm text-on-surface-variant" onClick={() => setDrafts(null)}>Cancel</button>
          </div>
        </div>
      )}

      {products.length > 0 && (
        <>
          <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
            {products.map((p) => (
              <li key={p._id} className="flex items-center gap-3 px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote product photo (Spaces), thumbnail only */}
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-surface-container" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{p.name}{p.price != null ? ` · ₹${p.price.toLocaleString('en-IN')}` : ''}</p>
                  <p className="text-xs text-on-surface-variant">
                    {p.scheduledPostAt && new Date(p.scheduledPostAt) > new Date()
                      ? `Posting on Google ${when(p.scheduledPostAt)}`
                      : p.lastPostedAt ? `On Google since ${when(p.lastPostedAt)}` : 'Not posted yet'}
                  </p>
                </div>
                <button type="button" className="text-xs font-semibold text-primary disabled:opacity-50" disabled={disabled} onClick={() => postNow([p._id])}>Post</button>
                <button type="button" className="text-xs text-on-surface-variant hover:text-error" disabled={disabled} onClick={() => remove(p._id)}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-on-surface">
              <input type="checkbox" checked={autoPost} onChange={toggleAuto} disabled={disabled} />
              Post one product every week automatically
            </label>
            <button type="button" className={btnOutline} disabled={disabled} onClick={() => postNow('all')}>Post all not posted recently</button>
          </div>
        </>
      )}
      <p className="text-xs text-on-surface-variant">Google doesn’t let apps fill its “Products” tab, so your products appear on your profile as product posts.</p>
    </Panel>
  );
}
