/**
 * Menu, hotel details, booking / order buttons and products — mirrors the
 * web component (src/components/gbp/RichProfileSections.tsx). Menu / hotel /
 * buttons save as proposals ("Ready to apply"); products are posted on
 * Google as product posts through the normal post scheduler.
 */
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, Switch, Text, View } from 'react-native';

import {
  fetchProducts,
  postProducts,
  removeProduct,
  saveProducts,
  scanMenu,
  scanProducts,
  setProductAutoPost,
  type MenuDraft,
  type MenuItem,
  type ProductButton,
  type ProductDraft,
  type ProductRow,
  type Recommendations,
  type UploadPhoto,
} from '@/api/endpoints/profileOptimization';
import { Field, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

type PanelComp = (p: { title: string; icon: any; hint?: string; count?: number; section?: string; children: ReactNode }) => ReactNode;

interface Props {
  recs: Recommendations;
  busy: boolean;
  propose: (key: string, body: object, onSaved?: () => void) => Promise<void> | void;
  notify: (title: string, text: string, ok: boolean) => void;
  Panel: PanelComp;
  CheckRow: (p: { label: string; checked: boolean; onPress: () => void }) => ReactNode;
  Hint: (p: { children: ReactNode; error?: boolean }) => ReactNode;
}

const dishCount = (d: MenuDraft | null | undefined) => (d ? d.sections.reduce((n, s) => n + s.items.length, 0) : 0);

async function pickPhotos(max: number, camera: boolean): Promise<UploadPhoto[]> {
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: !camera, selectionLimit: max };
  const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return [];
  return res.assets.slice(0, max).map((a, i) => ({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? `photo-${Date.now()}-${i}.jpg` }));
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ borderWidth: 1, borderColor: on ? t.brand : t.textFaint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text className="font-sans text-xs text-white">{label}</Text>
    </Pressable>
  );
}

export default function RichSections(props: Props) {
  return (
    <>
      {!!props.recs.foodMenu?.allowed && <MenuPanel {...props} />}
      {!!props.recs.lodging?.allowed && <HotelPanel {...props} />}
      {!!props.recs.buttons?.types?.length && <ButtonsPanel {...props} />}
      {props.recs.connected !== false && <ProductsPanel {...props} />}
    </>
  );
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function MenuPanel({ recs, busy, propose, notify, Panel, Hint }: Props) {
  const current = recs.foodMenu?.current ?? null;
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [reading, setReading] = useState(false);

  const scan = async (camera: boolean) => {
    const photos = await pickPhotos(4, camera);
    if (!photos.length) return;
    setReading(true);
    try {
      const res = await scanMenu(photos);
      if (!res.success || !res.draft) { notify('Couldn’t read the menu', res.error || 'Please try a clearer photo.', false); return; }
      setDraft(res.draft);
      notify('Menu read', `Found ${res.found} dishes${res.added ? ` — ${res.added} new` : ''}.${res.missingPrices ? ` ${res.missingPrices} need a price.` : ''} Check them, then save.`, true);
    } catch {
      notify('Couldn’t read the menu', 'Please try again.', false);
    } finally {
      setReading(false);
    }
  };

  const update = (si: number, ii: number, patch: Partial<MenuItem>) => setDraft((d) => d && {
    ...d,
    sections: d.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) })),
  });
  const remove = (si: number, ii: number) => setDraft((d) => d && {
    ...d,
    sections: d.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.filter((_, j) => j !== ii) })).filter((s) => s.items.length),
  });
  const missing = draft ? draft.sections.flatMap((s) => s.items).filter((i) => i.name.trim() && i.price == null).length : 0;

  return (
    <Panel section="menu" title="Menu" icon="restaurant" hint={draft ? `${dishCount(draft)} dishes — not saved` : current ? `${dishCount(current)} dishes on Google` : 'No menu yet'}>
      {!draft && (
        <>
          <Hint>{current ? `Your Google menu has ${dishCount(current)} dishes. Add a photo of your latest menu and we’ll add the new ones.` : 'Take a photo of your menu — we’ll read every dish and price for you.'}</Hint>
          <PrimaryButton title={reading ? 'Reading your menu…' : 'Take a photo of the menu'} loading={reading} disabled={busy || reading} onPress={() => void scan(true)} />
          <SecondaryButton title="Choose photos (up to 4)" disabled={busy || reading} onPress={() => void scan(false)} />
          {!!current && <SecondaryButton title="Edit current menu" disabled={busy} onPress={() => setDraft(current)} />}
        </>
      )}
      {!!draft && (
        <>
          {draft.sections.map((s, si) => (
            <View key={si} className="gap-2">
              <Text className="font-sans-bold text-sm text-white">{s.name}</Text>
              {s.items.map((it, ii) => (
                <View key={ii} className="gap-1.5 border-b border-surface-border pb-2">
                  <Field value={it.name} onChangeText={(v) => update(si, ii, { name: v })} placeholder="Dish name" />
                  <View className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <Field
                        value={it.price == null ? '' : String(it.price)}
                        keyboardType="decimal-pad"
                        placeholder="Price"
                        onChangeText={(v) => { const x = v.replace(/[^0-9.]/g, ''); update(si, ii, { price: x === '' ? null : Number(x) }); }}
                      />
                    </View>
                    <Chip label={it.veg === true ? 'Veg' : it.veg === false ? 'Non-veg' : 'Veg?'} on={it.veg != null} onPress={() => update(si, ii, { veg: it.veg === true ? false : it.veg === false ? null : true })} />
                    <Chip label="Remove" on={false} onPress={() => remove(si, ii)} />
                  </View>
                </View>
              ))}
            </View>
          ))}
          {missing > 0 && <Hint error>Google needs a price for every dish — {missing} still missing.</Hint>}
          <PrimaryButton
            title={`Save menu (${dishCount(draft)} dishes)`}
            disabled={busy || missing > 0 || !dishCount(draft)}
            onPress={() => propose('menu', { kind: 'food_menu', source: 'owner', proposed: { draft: { ...draft, sections: draft.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.name.trim()) })) } } }, () => setDraft(null))}
          />
          <SecondaryButton title="Cancel" disabled={busy} onPress={() => setDraft(null)} />
          <Hint>Saving replaces the menu on Google. Photos and options you added in Google for a dish stay.</Hint>
        </>
      )}
    </Panel>
  );
}

// ─── Hotel details ────────────────────────────────────────────────────────────

function HotelPanel({ recs, busy, propose, Panel, CheckRow, Hint }: Props) {
  const lodging = recs.lodging!;
  const initial = useMemo(() => {
    const v: Record<string, boolean | string | null> = { ...(lodging.current || {}) };
    for (const p of lodging.suggested || []) if (v[p] == null) v[p] = true;
    return v;
  }, [lodging]);
  const [values, setValues] = useState(initial);
  useEffect(() => setValues(initial), [initial]);
  const changed = Object.keys(values).filter((p) => (values[p] ?? null) !== (lodging.current?.[p] ?? null) && values[p] !== null);
  const groups = [...new Set(lodging.fields.map((f) => f.group))];

  if (!lodging.readable) {
    return <Panel section="hotel" title="Hotel details" icon="bed" hint="Unavailable"><Hint>We couldn’t read your hotel details from Google right now.</Hint></Panel>;
  }
  return (
    <Panel section="hotel" title="Hotel details" icon="bed" hint={changed.length ? `${changed.length} to update` : 'Up to date'} count={changed.length}>
      <Hint>Guests filter hotels by these on Google.{lodging.suggested.length ? ' We ticked the ones your website mentions — untick any you don’t have.' : ''}</Hint>
      {groups.map((g) => (
        <View key={g} className="gap-1">
          <Text className="font-sans-semibold text-xs text-zinc-300">{g}</Text>
          {lodging.fields.filter((f) => f.group === g).map((f) => f.type === 'time' ? (
            <View key={f.path} className="gap-1">
              <Hint>{f.label} (HH:MM)</Hint>
              <Field value={String(values[f.path] ?? '')} placeholder="12:00" keyboardType="numbers-and-punctuation" onChangeText={(v) => setValues({ ...values, [f.path]: v.trim() || null })} />
            </View>
          ) : (
            <CheckRow
              key={f.path}
              label={f.label}
              checked={values[f.path] === true}
              onPress={() => setValues({ ...values, [f.path]: values[f.path] === true ? (lodging.current?.[f.path] === true ? false : (lodging.current?.[f.path] ?? null)) : true })}
            />
          ))}
        </View>
      ))}
      <PrimaryButton
        title={`Save ${changed.length || ''} hotel detail${changed.length === 1 ? '' : 's'}`}
        disabled={busy || !changed.length}
        onPress={() => propose('lodging', { kind: 'lodging', source: lodging.suggested.length ? 'recommendation' : 'owner', proposed: Object.fromEntries(changed.map((p) => [p, values[p]])) })}
      />
    </Panel>
  );
}

// ─── Booking / order buttons ──────────────────────────────────────────────────

function ButtonsPanel({ recs, busy, propose, Panel, Hint }: Props) {
  const types = recs.buttons!.types;
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => setLinks(Object.fromEntries(types.map((t) => [t.placeActionType, t.current || t.suggested || '']))), [types]);
  const missing = types.filter((t) => !t.current && !t.partner).length;
  return (
    <Panel section="buttons" title="Booking & order buttons" icon="calendar" hint={missing ? `${missing} not set` : 'All set'} count={missing}>
      <Hint>Customers book or order from your Google profile in one tap.</Hint>
      {types.map((t) => {
        const value = links[t.placeActionType] ?? '';
        return (
          <View key={t.placeActionType} className="gap-1.5">
            <Text className="font-sans-semibold text-sm text-white">{t.label}</Text>
            {!!t.partner && !t.current && <Hint>A booking partner already provides this button.</Hint>}
            {!t.current && !!t.suggested && <Hint>Found on your website — check it’s the right page.</Hint>}
            <Field value={value} autoCapitalize="none" keyboardType="url" placeholder="https://your-booking-page.com" onChangeText={(v) => setLinks({ ...links, [t.placeActionType]: v })} />
            <SecondaryButton
              title={t.current ? 'Update' : 'Add button'}
              disabled={busy || !value.trim() || value.trim() === (t.current || '')}
              onPress={() => propose(`button:${t.placeActionType}`, { kind: 'place_action', source: !t.current && value === t.suggested ? 'recommendation' : 'owner', proposed: { placeActionType: t.placeActionType, uri: value.trim() } })}
            />
            {!!t.current && <SecondaryButton title="Remove" disabled={busy} onPress={() => propose(`button:${t.placeActionType}`, { kind: 'place_action', source: 'owner', proposed: { placeActionType: t.placeActionType, uri: null } })} />}
          </View>
        );
      })}
    </Panel>
  );
}

// ─── Products ─────────────────────────────────────────────────────────────────

const BUTTON_TEXT: Record<ProductButton, string> = { SHOP: 'Buy', ORDER: 'Order', LEARN_MORE: 'Learn more', CALL: 'Call' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

function ProductsPanel({ busy, notify, Panel, Hint }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [autoPost, setAutoPost] = useState(false);
  const [website, setWebsite] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ProductDraft[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await fetchProducts();
      setProducts(r.products);
      setAutoPost(r.autoPost);
      setWebsite(r.website);
    } catch { /* section stays empty */ }
  };
  useEffect(() => { void reload(); }, []);

  const scan = async (camera: boolean) => {
    const photos = await pickPhotos(10, camera);
    if (!photos.length) return;
    setWorking('scan');
    try {
      const res = await scanProducts(photos);
      if (!res.success || !res.drafts) { notify('Couldn’t read the photos', res.error || 'Please try again.', false); return; }
      const button: ProductButton = website && /^https:/i.test(website) ? 'SHOP' : 'CALL';
      setDrafts([...(drafts || []), ...res.drafts.map((d) => ({ ...d, button, buttonUrl: '' }))]);
    } catch {
      notify('Couldn’t read the photos', 'Please try again.', false);
    } finally {
      setWorking(null);
    }
  };

  const save = async (post: boolean) => {
    if (!drafts?.length) return;
    setWorking('save');
    try {
      const res = await saveProducts(drafts, post);
      if (!res.success) { notify('Not saved', res.error || 'Please check the products.', false); return; }
      setDrafts(null);
      notify('Products saved', post && res.posting?.scheduled
        ? `They’ll be posted on Google one at a time${res.posting.first ? `, starting ${when(res.posting.first)}` : ''}. We’ll keep posting one a week.`
        : `Saved ${res.products?.length ?? drafts.length} products.`, true);
      await reload();
    } finally {
      setWorking(null);
    }
  };

  const edit = (i: number, patch: Partial<ProductDraft>) => setDrafts((d) => d && d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const disabled = busy || !!working;

  return (
    <Panel section="products" title="Products" icon="pricetag" hint={drafts ? `${drafts.length} not saved` : products.length ? `${products.length} products` : 'Add your products'}>
      <Hint>Take photos of what you sell — we write the details and post each product on Google with its photo, price and a button.</Hint>
      <PrimaryButton title={working === 'scan' ? 'Reading photos…' : 'Take a product photo'} loading={working === 'scan'} disabled={disabled} onPress={() => void scan(true)} />
      <SecondaryButton title="Choose photos (up to 10)" disabled={disabled} onPress={() => void scan(false)} />

      {!!drafts && drafts.map((d, i) => (
        <View key={i} className="gap-1.5 rounded-xl border border-surface-border p-2.5">
          <View className="flex-row gap-2.5">
            {!!d.imageUrl && <Image source={{ uri: d.imageUrl }} style={{ width: 64, height: 64, borderRadius: 8 }} />}
            <View className="flex-1 gap-1.5">
              <Field value={d.name} placeholder="Product name" onChangeText={(v) => edit(i, { name: v })} />
              <Field value={d.price == null ? '' : String(d.price)} keyboardType="decimal-pad" placeholder="Price (optional)" onChangeText={(v) => { const x = v.replace(/[^0-9.]/g, ''); edit(i, { price: x === '' ? null : Number(x) }); }} />
            </View>
          </View>
          <Field value={d.description} multiline placeholder="Short description" onChangeText={(v) => edit(i, { description: v })} />
          <View className="flex-row flex-wrap gap-1.5">
            {(Object.keys(BUTTON_TEXT) as ProductButton[]).map((b) => <Chip key={b} label={`${d.button === b ? '✓ ' : ''}${BUTTON_TEXT[b]}`} on={d.button === b} onPress={() => edit(i, { button: b })} />)}
            <Chip label="Remove" on={false} onPress={() => setDrafts(drafts.filter((_, j) => j !== i))} />
          </View>
          {d.button !== 'CALL' && <Field value={d.buttonUrl} autoCapitalize="none" keyboardType="url" placeholder={website ? `Link (default: ${website})` : 'https://… page for this product'} onChangeText={(v) => edit(i, { buttonUrl: v })} />}
        </View>
      ))}
      {!!drafts?.length && (
        <>
          <PrimaryButton title={`Save & post ${drafts.length} to Google`} loading={working === 'save'} disabled={disabled || drafts.some((d) => d.name.trim().length < 2)} onPress={() => void save(true)} />
          <SecondaryButton title="Save only" disabled={disabled || drafts.some((d) => d.name.trim().length < 2)} onPress={() => void save(false)} />
        </>
      )}

      {products.map((p) => (
        <View key={p._id} className="flex-row items-center gap-2.5 border-b border-surface-border py-1.5">
          {p.imageUrl ? <Image source={{ uri: p.imageUrl }} style={{ width: 40, height: 40, borderRadius: 6 }} /> : <View style={{ width: 40, height: 40 }} />}
          <View className="flex-1">
            <Text className="font-sans-semibold text-sm text-white" numberOfLines={1}>{p.name}{p.price != null ? ` · ₹${p.price.toLocaleString('en-IN')}` : ''}</Text>
            <Text className="font-sans text-xs text-zinc-400">
              {p.scheduledPostAt && new Date(p.scheduledPostAt) > new Date() ? `Posting ${when(p.scheduledPostAt)}` : p.lastPostedAt ? `On Google since ${when(p.lastPostedAt)}` : 'Not posted yet'}
            </Text>
          </View>
          <Chip label="Post" on={false} onPress={async () => {
            const r = await postProducts([p._id]).catch(() => null);
            notify(r?.success && r.posting?.scheduled ? 'Scheduled' : 'Nothing to post', r?.success ? (r.posting?.scheduled ? `Posting ${when(r.posting.first || undefined)}.` : 'Posted recently.') : r?.error || 'Please try again.', !!r?.success);
            await reload();
          }} />
          <Chip label="Remove" on={false} onPress={async () => { await removeProduct(p._id).catch(() => {}); await reload(); }} />
        </View>
      ))}
      {products.length > 0 && (
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-sans text-sm text-white">Post one product every week automatically</Text>
          <Switch value={autoPost} onValueChange={(v) => { setAutoPost(v); setProductAutoPost(v).catch(() => setAutoPost(!v)); }} />
        </View>
      )}
      <Hint>Google doesn’t let apps fill its “Products” tab, so your products appear on your profile as product posts.</Hint>
    </Panel>
  );
}
