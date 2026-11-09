import "server-only";
import { adminServices } from "./firebase";
import { AccessError } from "./auth";
import { GoogleTokenClaims, isFreshVerifiedGoogleToken, normalizeAccountEmail } from "../google-auth-policy";

export async function designatedOwnerUid() {
  const pinned = process.env.QUOTEFORGE_OWNER_UID;
  const config = (await adminServices().db.doc("platform/config").get()).data();
  if (pinned && config?.ownerUid && pinned !== config.ownerUid) throw new AccessError(503, "The designated owner configuration does not match.");
  return pinned || (typeof config?.ownerUid === "string" ? config.ownerUid : undefined);
}
export async function prepareOwnerSignIn(token: GoogleTokenClaims): Promise<{isOwner: boolean; refreshRequired: boolean}> {
  const ownerEmail = normalizeAccountEmail(process.env.QUOTEFORGE_OWNER_EMAIL || "");
  if (!ownerEmail || normalizeAccountEmail(token.email || "") !== ownerEmail) return {isOwner: false, refreshRequired: false};
  if (!isFreshVerifiedGoogleToken(token)) throw new AccessError(401, "Sign in again using your verified Google account.");
  const {auth, db} = adminServices();
  const pinned = process.env.QUOTEFORGE_OWNER_UID;
  if (process.env.NODE_ENV === "production" && !pinned) throw new AccessError(503, "The owner Firebase UID must be initialized through administrator configuration before sign-in.");
  if (pinned && token.uid !== pinned) throw new AccessError(403, "This Google identity does not match the designated owner UID.");
  await db.runTransaction(async transaction => {
    const reference = db.doc("platform/config");
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      if (snapshot.data()?.ownerUid !== token.uid || pinned && snapshot.data()?.ownerUid !== pinned) throw new AccessError(403, "This account cannot replace the platform owner.");
      return;
    }
    if (!pinned && process.env.QUOTEFORGE_OWNER_BOOTSTRAP_ENABLED !== "true") throw new AccessError(503, "The designated owner has not been initialized.");
    transaction.create(reference, {ownerUid: token.uid, ownerEmail, createdAt: new Date().toISOString()});
  });
  if (token.platformOwner !== true) {
    const user = await auth.getUser(token.uid);
    await auth.setCustomUserClaims(token.uid, {...user.customClaims, platformOwner: true});
    return {isOwner: true, refreshRequired: true};
  }
  return {isOwner: true, refreshRequired: false};
}
