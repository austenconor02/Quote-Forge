import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
export async function GET() {
  const token = randomBytes(32).toString("base64url");
  (await cookies()).set("__qf_csrf", token, {httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 600});
  return Response.json({csrfToken: token}, {headers: {"Cache-Control": "no-store", "Vary": "Cookie"}});
}
