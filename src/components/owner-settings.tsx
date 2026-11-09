"use client";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { LEGACY_STORAGE_KEY, LEGACY_TENANT_PREFIX } from "@/lib/workspace-storage";
import { useIntegrationStatus } from "./use-integration-status";
import { SignOutButton } from "./sign-out-button";
export function OwnerSettings() {
  const { data, toast, demo } = useWorkspace();
  const integrations = useIntegrationStatus();
  function exportData(recovery = false) {
    try {
      const legacy = recovery ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
      const tenantSnapshots: Record<string, string> = {};
      if (recovery) for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(LEGACY_TENANT_PREFIX)) tenantSnapshots[key] = localStorage.getItem(key)!; }
      const blob = new Blob([JSON.stringify(recovery ? { currentWorkspace: data, originalLegacyWorkspace: legacy, originalLegacyTenantSnapshots: tenantSnapshots } : data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = recovery ? "quoteforge-recovery-data.json" : "quoteforge-workspace.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast("The export could not be created. Existing browser data has not been changed."); }
  }
  return <div className="owner-settings-page"><Link href="/" className="owner-back-link"><ArrowLeft size={15}/>My Companies</Link><div className="owner-page-title"><h1>Settings</h1></div><section className="owner-settings-section"><h2>Account & data</h2><dl><div><dt>Owner access</dt><dd>{demo ? "Local development workspace" : "Verified Google platform owner"}</dd></div><div><dt>Data storage</dt><dd>{demo ? "This browser" : integrations.emulators ? "Isolated local Firebase emulators" : "Private Firebase project"}</dd></div><div><dt>Production access</dt><dd>Verified designated owner required</dd></div></dl><div className="owner-export-buttons"><button className="button secondary" onClick={() => exportData()}><Download size={15}/>{demo ? "Export workspace" : "Export loaded records"}</button>{demo && <button className="button secondary" onClick={() => exportData(true)}><Download size={15}/>Export recovery data</button>}{!demo && <SignOutButton/>}</div><p className="owner-setting-note">{demo ? "Original local data is preserved in the recovery export." : "The export includes companies and operational records loaded in this browser. Source files remain in private cloud storage."}</p></section><section className="owner-settings-section"><h2>Integrations</h2><dl><div><dt>Firebase</dt><dd>{integrations.cloud ? integrations.emulators ? "Connected to isolated emulators" : "Connected" : "Target: quote-forge-b153f; live configuration pending"}</dd></div><div><dt>Documents</dt><dd>PDF text, scanned pages, image OCR, and HEIC processing enabled</dd></div><div><dt>AI generation</dt><dd>Original server engine and credentials required</dd></div><div><dt>Invitation delivery</dt><dd>{integrations.invitationsReady ? "EmailJS configured" : "EmailJS template and keys pending; sending disabled"}</dd></div><div><dt>App installation</dt><dd>Tenant manifests and icons prepared; HTTPS and saved logos required</dd></div></dl></section></div>;
}
