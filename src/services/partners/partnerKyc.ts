import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import GrowthPartner from '@/models/GrowthPartner';
import User from '@/models/User';
import AdminActionLog from '@/models/AdminActionLog';
import { encrypt, decrypt, encryptBuffer, decryptBuffer } from '@/lib/crypto';
import { deleteKeys, getPrivateObject, isStorageConfigured, uploadPrivateObject } from '@/lib/storage';
import {
  KYC_DOC_KINDS,
  KYC_DOC_LABELS,
  KYC_MAX_FILE_BYTES,
  maskLast4,
  missingDocs,
  sniffKycFileType,
  validateKycSubmission,
  type KycDocKind,
} from '@/lib/partners/kycRules';
import {
  sendKycRejectedEmail,
  sendKycSubmittedAdminAlert,
  sendKycVerifiedEmail,
} from '@/services/partners/partnerEmails';

/**
 * Growth Partner KYC: documents, identity and bank details for payouts.
 *
 * - Partner side works only on the session partner (requireGrowthPartner).
 * - PAN and account number are encrypted in the database; the partner only
 *   ever sees them masked. The super admin sees them in full (needed to
 *   verify and to pay), and every such view is written to AdminActionLog.
 * - Files are encrypted before upload to private storage, so the bucket on
 *   its own reveals nothing.
 * - While a submission is under review it is locked. Changing a verified KYC
 *   sends it back for review (payouts need it verified again).
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

function safeDecrypt(v?: string | null): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

function docList(partner: any) {
  return ((partner.kyc?.documents ?? []) as any[]).map((d) => ({
    id: String(d._id),
    kind: d.kind,
    label: KYC_DOC_LABELS[d.kind as KycDocKind] ?? d.kind,
    contentType: d.contentType,
    fileName: d.fileName,
    size: d.size,
    uploadedAt: d.uploadedAt,
  }));
}

/** What the partner sees: everything they entered, with PAN / account number masked. */
export function partnerKycView(partner: any) {
  const k = partner.kyc ?? {};
  return {
    kycStatus: partner.kycStatus,
    rejectReason: partner.kycStatus === 'rejected' ? k.rejectReason ?? null : null,
    submittedAt: k.submittedAt ?? null,
    reviewedAt: k.reviewedAt ?? null,
    entityType: k.entityType ?? null,
    legalName: k.legalName ?? '',
    companyType: k.companyType ?? null,
    gstin: k.gstin ?? null,
    registrationNumber: k.registrationNumber ?? null,
    address: k.address ?? '',
    pincode: k.pincode ?? '',
    panMasked: k.panLast4 ? maskLast4(k.panLast4, 10) : null,
    aadhaarMasked: k.aadhaarLast4 ? maskLast4(k.aadhaarLast4, 12) : null,
    bank: k.bank
      ? {
          accountHolderName: k.bank.accountHolderName ?? '',
          accountMasked: k.bank.accountLast4 ? maskLast4(k.bank.accountLast4, 10) : null,
          ifsc: k.bank.ifsc ?? '',
          bankName: k.bank.bankName ?? '',
          accountType: k.bank.accountType ?? null,
        }
      : null,
    documents: docList(partner),
  };
}

async function logAction(adminId: string, action: string, metadata: Record<string, unknown>) {
  try {
    const admin = await User.findById(adminId).select('email').lean<{ email?: string }>();
    await AdminActionLog.create({ adminUserId: adminId, adminEmail: admin?.email, action, metadata });
  } catch (err: any) {
    console.error(`[partnerKyc] admin action log failed (${action}):`, err?.message);
  }
}

// ── Partner side ─────────────────────────────────────────────────────────

/** Upload (or replace) one KYC document. */
export async function uploadKycDocument(
  partnerId: string,
  kindRaw: unknown,
  file: File | null
): Promise<({ ok: true } & { kycStatus: string; document: ReturnType<typeof docList>[number] }) | Fail> {
  const kind = typeof kindRaw === 'string' ? (kindRaw as KycDocKind) : null;
  if (!kind || !KYC_DOC_KINDS.includes(kind)) return fail(400, 'Unknown document type.');
  if (!file || file.size === 0) return fail(400, 'Choose a file to upload.');
  if (file.size > KYC_MAX_FILE_BYTES) return fail(400, 'The file is too large. The limit is 5 MB.');
  if (!isStorageConfigured()) return fail(503, 'Document upload is not available right now. Please try again later.');

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = sniffKycFileType(bytes);
  if (!contentType) return fail(400, 'Upload a JPG, PNG, WEBP image or a PDF.');

  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).select('kycStatus kyc.documents').lean<any>();
  if (!partner) return fail(404, 'Partner not found');
  if (partner.kycStatus === 'submitted') return fail(409, 'Your KYC is under review. You can change it after we review it.');

  const storageKey = await uploadPrivateObject(encryptBuffer(bytes), 'application/octet-stream', `partner-kyc/${partnerId}`);
  const docId = new mongoose.Types.ObjectId();
  const document = {
    _id: docId,
    kind,
    storageKey,
    contentType,
    fileName: (file.name || kind).replace(/[^\w.\- ]+/g, '_').slice(0, 120),
    size: file.size,
    uploadedAt: new Date(),
  };

  // Changing a verified KYC sends it back for review.
  const nextStatus = partner.kycStatus === 'verified' ? 'not_submitted' : partner.kycStatus;
  await GrowthPartner.updateOne({ _id: partnerId }, { $pull: { 'kyc.documents': { kind } } });
  await GrowthPartner.updateOne(
    { _id: partnerId },
    { $push: { 'kyc.documents': document }, $set: { kycStatus: nextStatus } }
  );

  const old = ((partner.kyc?.documents ?? []) as any[]).filter((d) => d.kind === kind).map((d) => d.storageKey);
  if (old.length) await deleteKeys(old).catch(() => 0);

  return { ok: true, kycStatus: nextStatus, document: docList({ kyc: { documents: [document] } })[0] };
}

/** Submit the KYC form for review. All required documents must already be uploaded. */
export async function submitKyc(partnerId: string, body: Record<string, unknown>) {
  const parsed = validateKycSubmission(body);
  if (!parsed.ok) return fail(400, parsed.error);
  const v = parsed.value;

  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).lean<any>();
  if (!partner) return fail(404, 'Partner not found');
  if (partner.kycStatus === 'submitted') return fail(409, 'Your KYC is already under review.');

  const uploaded = ((partner.kyc?.documents ?? []) as any[]).map((d) => d.kind);
  const missing = missingDocs(v.entityType, !!v.gstin, uploaded);
  if (missing.length) {
    return fail(400, `Please upload: ${missing.map((k) => KYC_DOC_LABELS[k]).join(', ')}.`);
  }

  const updated = await GrowthPartner.findOneAndUpdate(
    { _id: partnerId, kycStatus: { $ne: 'submitted' } },
    {
      $set: {
        kycStatus: 'submitted',
        'kyc.entityType': v.entityType,
        'kyc.legalName': v.legalName,
        'kyc.companyType': v.companyType,
        'kyc.gstin': v.gstin,
        'kyc.registrationNumber': v.registrationNumber,
        'kyc.address': v.address,
        'kyc.pincode': v.pincode,
        'kyc.panEncrypted': encrypt(v.pan),
        'kyc.panLast4': v.pan.slice(-4),
        'kyc.aadhaarLast4': v.aadhaarLast4,
        'kyc.bank': {
          accountHolderName: v.bank.accountHolderName,
          accountNumberEncrypted: encrypt(v.bank.accountNumber),
          accountLast4: v.bank.accountNumber.slice(-4),
          ifsc: v.bank.ifsc,
          bankName: v.bank.bankName,
          accountType: v.bank.accountType,
        },
        'kyc.submittedAt': new Date(),
        'kyc.rejectReason': null,
      },
    },
    { new: true }
  ).lean<any>();
  if (!updated) return fail(409, 'Your KYC is already under review.');

  await sendKycSubmittedAdminAlert(updated);
  return { ok: true as const, kyc: partnerKycView(updated) };
}

/** A partner's own document, decrypted. */
export async function readKycDocument(partnerId: string, docId: string) {
  if (!mongoose.Types.ObjectId.isValid(docId)) return null;
  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).select('kyc.documents').lean<any>();
  const doc = ((partner?.kyc?.documents ?? []) as any[]).find((d) => String(d._id) === docId);
  if (!doc || !String(doc.storageKey).startsWith(`partner-kyc/${partnerId}/`)) return null;
  if (!isStorageConfigured()) return null;
  const obj = await getPrivateObject(doc.storageKey);
  if (!obj) return null;
  return { body: decryptBuffer(obj.body), contentType: doc.contentType as string, fileName: doc.fileName as string };
}

// ── Super admin side ─────────────────────────────────────────────────────

/** Full KYC including PAN and account number in clear. Logged. */
export async function adminKycView(partnerId: string, adminId: string) {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return null;
  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).lean<any>();
  if (!partner) return null;
  const k = partner.kyc ?? {};
  await logAction(adminId, 'partner.kyc_view', { partnerId });
  const base = partnerKycView(partner);
  return {
    ...base,
    partner: {
      id: String(partner._id),
      partnerCode: partner.partnerCode,
      companyName: partner.companyName,
      fullName: partner.fullName,
      email: partner.email,
    },
    rejectReason: k.rejectReason ?? null,
    pan: safeDecrypt(k.panEncrypted),
    bank: base.bank ? { ...base.bank, accountNumber: safeDecrypt(k.bank?.accountNumberEncrypted) } : null,
  };
}

export async function adminReadKycDocument(partnerId: string, docId: string, adminId: string) {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return null;
  const doc = await readKycDocument(partnerId, docId);
  if (doc) await logAction(adminId, 'partner.kyc_document_view', { partnerId, docId });
  return doc;
}

/** Verify or reject a submitted KYC. A rejection needs a reason (it is emailed to the partner). */
export async function reviewKyc(partnerId: string, decision: unknown, reasonRaw: unknown, adminId: string) {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return fail(404, 'Partner not found');
  if (decision !== 'verify' && decision !== 'reject') return fail(400, 'Choose verify or reject.');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : '';
  if (decision === 'reject' && reason.length < 3) return fail(400, 'Tell the partner what to fix.');

  await dbConnect();
  const updated = await GrowthPartner.findOneAndUpdate(
    { _id: partnerId, kycStatus: 'submitted' },
    {
      $set: {
        kycStatus: decision === 'verify' ? 'verified' : 'rejected',
        'kyc.reviewedAt': new Date(),
        'kyc.reviewedBy': adminId,
        'kyc.rejectReason': decision === 'reject' ? reason : null,
      },
    },
    { new: true }
  ).lean<any>();
  if (!updated) {
    const exists = await GrowthPartner.exists({ _id: partnerId });
    return exists ? fail(409, 'This KYC is not waiting for review.') : fail(404, 'Partner not found');
  }

  if (decision === 'verify') await sendKycVerifiedEmail(updated.email, updated.fullName);
  else await sendKycRejectedEmail(updated.email, updated.fullName, reason);
  await logAction(adminId, decision === 'verify' ? 'partner.kyc_verify' : 'partner.kyc_reject', { partnerId, reason: reason || undefined });
  return { ok: true as const, kycStatus: updated.kycStatus as string };
}
