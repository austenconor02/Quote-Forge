import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { createInvitationAssetService } from "../../src/lib/server/invitation-assets";
import { INVITATION_LIFETIME_MS } from "../../src/lib/invitation-policy";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.APP_ORIGIN = "https://quoteforge.example.test";
const projectId = "demo-quoteforge-invitation-assets";
const app = initializeApp({projectId, storageBucket: `${projectId}.appspot.com`, credential: applicationDefault()}, "invitation-assets-test");
const db = getFirestore(app), bucket = getStorage(app).bucket();
const assetIds: string[] = [], paths: string[] = [];
let clock = Date.now();
const service = createInvitationAssetService({db, bucket, now: () => clock});
const expires = () => new Date(clock + INVITATION_LIFETIME_MS).toISOString();
const company = () => ({id: `email-logo-${randomUUID()}`, name: "Customer Company", branding: {primary: "#FFAA00"}});
function remember(url: string) {const id = new URL(url).pathname.split("/").pop()!.slice(0, -4); assetIds.push(id); return id;}
after(async () => {
  for (const id of assetIds) {const reference = db.doc(`invitationEmailAssets/${id}`); const data = (await reference.get()).data(); if (data?.storagePath) paths.push(data.storagePath); await reference.delete();}
  await Promise.all(paths.map(path => bucket.file(path).delete({ignoreNotFound: true}).catch(() => {})));
  await deleteApp(app);
});

test("email clients receive only a bounded PNG snapshot of the selected company logo", async () => {
  const stored = company();
  const original = await sharp({create: {width: 512, height: 128, channels: 4, background: "#D52A52"}}).png().toBuffer();
  const hash = createHash("sha256").update(original).digest("hex");
  const path = `companies/${stored.id}/branding/${hash}.png`; paths.push(path);
  await bucket.file(path).save(original, {metadata: {contentType: "image/png"}});
  const branding = await service.prepare({...stored, branding: {...stored.branding, logoStoragePath: path}}, expires());
  const id = remember(branding.companyLogoUrl);
  assert.ok(!branding.companyLogoUrl.includes(stored.id));
  assert.match(branding.companyLogoUrl, /^https:\/\/quoteforge\.example\.test\/api\/invitations\/logo\/[A-Za-z0-9_-]{43}\.png$/);
  assert.equal(branding.primaryColor, "#FFAA00"); assert.equal(branding.headerTextColor, "#000000");
  const image = await service.read(id);
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 64); assert.equal(metadata.format, "png"); assert.equal(metadata.exif, undefined);
  const pixels = await sharp(image).raw().toBuffer(); assert.deepEqual([...pixels.subarray(0, 3)], [213, 42, 82]);
  const record = (await db.doc(`invitationEmailAssets/${id}`).get()).data()!;
  assert.equal(record.email, undefined); assert.equal(record.token, undefined);
  assert.equal(record.expiresAt.toMillis() - clock, INVITATION_LIFETIME_MS);
});

test("a company without a saved logo gets its own branded initials, never the owner logo", async () => {
  const branding = await service.prepare(company(), expires()), id = remember(branding.companyLogoUrl);
  const image = await service.read(id);
  const metadata = await sharp(image).metadata(); assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
  const pixel = await sharp(image).extract({left: 10, top: 128, width: 1, height: 1}).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel], [255, 170, 0]);
});

test("logo URLs expire and cannot be used to read another company path or changed file contents", async () => {
  const branding = await service.prepare(company(), expires()), id = remember(branding.companyLogoUrl);
  const reference = db.doc(`invitationEmailAssets/${id}`), original = (await reference.get()).data()!;
  await reference.update({storagePath: "companies/another-company/documents/private.pdf"});
  await assert.rejects(service.read(id), /unavailable/);
  await reference.update({storagePath: original.storagePath});
  const file = bucket.file(original.storagePath);
  await file.save(Buffer.from("tampered contents"), {metadata: {contentType: "image/png"}});
  await assert.rejects(service.read(id), /unavailable/);
  clock += INVITATION_LIFETIME_MS;
  await assert.rejects(service.read(id), /unavailable/);
  await assert.rejects(service.read("../private-record"), /unavailable/);
});

test("branding preparation rejects arbitrary remote images and cross-company private logo paths", async () => {
  const stored = company();
  for (const path of ["https://untrusted.example/logo.png", `companies/other/branding/${"a".repeat(64)}.png`]) {
    await assert.rejects(service.prepare({...stored, branding: {...stored.branding, logoStoragePath: path}}, expires()), /path is invalid/);
  }
});
