import "server-only";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { invitationOrigin, INVITATION_LIFETIME_MS } from "../invitation-policy";
import { invitationEmailBranding, type StoredInvitationCompany } from "../invitation-email-branding";

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
export class InvitationAssetError extends Error {constructor(public status: number, message: string) {super(message);}}
type Dependencies = {db: Firestore; bucket: Pick<Bucket, "file">; now?: () => number};

/** Only sanitized logo snapshots are intentionally public; company records and originals remain private. */
export function createInvitationAssetService({db, bucket, now = Date.now}: Dependencies) {
  async function prepare(company: StoredInvitationCompany, expiry: string) {
    const origin = invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production");
    const expiryMs = Date.parse(expiry);
    if (!origin || !/^[A-Za-z0-9-]{1,100}$/.test(company.id) || !Number.isFinite(expiryMs) || expiryMs <= now() || expiryMs > now() + INVITATION_LIFETIME_MS + 60000) throw new InvitationAssetError(400, "The invitation branding or expiration is invalid.");
    const colors = invitationEmailBranding(company.branding.primary, "");
    const originalPath = company.branding.logoStoragePath;
    let logo: Buffer;
    if (originalPath) {
      const prefix = `companies/${company.id}/branding/`;
      const filename = originalPath.slice(prefix.length);
      if (!originalPath.startsWith(prefix) || !/^[a-f0-9]{64}\.png$/.test(filename)) throw new InvitationAssetError(400, "The saved company logo path is invalid.");
      const file = bucket.file(originalPath);
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_BYTES || metadata.contentType !== "image/png") throw new InvitationAssetError(413, "The saved company logo cannot be used in this invitation.");
      const [bytes] = await file.download({start: 0, end: MAX_SOURCE_BYTES});
      if (bytes.length !== size || digest(bytes) !== filename.slice(0, -4)) throw new InvitationAssetError(409, "The saved company logo could not be verified.");
      logo = await sharp(bytes, {limitInputPixels: 16000000}).rotate().resize({width: 256, height: 256, fit: "inside", withoutEnlargement: true}).png().toBuffer();
    } else {
      const initials = company.name.trim().split(/\s+/).slice(0, 2).map(word => [...word].find(character => /[\p{L}\p{N}]/u.test(character)) || "").join("").toUpperCase() || "CO";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="24" fill="${colors.primaryColor}"/><text x="128" y="148" text-anchor="middle" font-family="Arial,sans-serif" font-size="88" font-weight="700" fill="${colors.headerTextColor}">${initials}</text></svg>`;
      logo = await sharp(Buffer.from(svg)).png().toBuffer();
    }
    if (!logo.length || logo.length > MAX_LOGO_BYTES) throw new InvitationAssetError(413, "The company email logo exceeds the image limit.");
    const id = randomBytes(32).toString("base64url");
    const storagePath = `companies/${company.id}/invitation-branding/${id}.png`;
    const sha256 = digest(logo);
    const file = bucket.file(storagePath);
    await file.save(logo, {resumable: false, metadata: {contentType: "image/png", cacheControl: "private, no-store", metadata: {sha256}}});
    try {await db.doc(`invitationEmailAssets/${id}`).create({companyId: company.id, storagePath, sha256, size: logo.length, createdAt: Timestamp.fromMillis(now()), expiresAt: Timestamp.fromMillis(expiryMs)});}
    catch (error) {await file.delete({ignoreNotFound: true}).catch(() => {}); throw error;}
    return {...colors, companyLogoUrl: `${origin}/api/invitations/logo/${id}.png`};
  }

  async function read(id: string) {
    const unavailable = () => new InvitationAssetError(404, "Invitation logo unavailable.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw unavailable();
    const validRecord = async () => {
      const data = (await db.doc(`invitationEmailAssets/${id}`).get()).data();
      if (!data || !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now() || !/^[A-Za-z0-9-]{1,100}$/.test(data.companyId) || data.storagePath !== `companies/${data.companyId}/invitation-branding/${id}.png` || !/^[a-f0-9]{64}$/.test(data.sha256)) throw unavailable();
      return data;
    };
    const data = await validRecord();
    const file = bucket.file(data.storagePath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_LOGO_BYTES || size !== data.size || metadata.contentType !== "image/png" || metadata.metadata?.firebaseStorageDownloadTokens) throw unavailable();
    const [bytes] = await file.download({start: 0, end: MAX_LOGO_BYTES});
    if (bytes.length !== size || bytes.length > MAX_LOGO_BYTES || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || digest(bytes) !== data.sha256) throw unavailable();
    await validRecord();
    return bytes;
  }
  return {prepare, read};
}
