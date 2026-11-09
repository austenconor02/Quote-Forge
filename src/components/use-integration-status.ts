"use client";
import { useEffect, useState } from "react";
export function useIntegrationStatus() {
  const [status, setStatus] = useState({cloud: false, emulators: false, invitationsReady: false, documentProcessing: true, aiGeneration: false});
  useEffect(() => {let cancelled = false; fetch("/api/integrations", {cache: "no-store", credentials: "same-origin"}).then(async response => {if (response.ok) {const value = await response.json(); if (!cancelled) setStatus({cloud: value.cloud === true, emulators: value.emulators === true, invitationsReady: value.invitationsReady === true, documentProcessing: true, aiGeneration: false});}}).catch(() => {}); return () => {cancelled = true;};}, []);
  return status;
}
