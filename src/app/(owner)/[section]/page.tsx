import { notFound } from "next/navigation";
import { MyCompanies } from "@/components/my-companies";
import { CompanyWizard } from "@/components/company-wizard";
import { FieldBuilder } from "@/components/field-builder";
import { LegacyOwnerRoute } from "@/components/legacy-owner-route";
import { OwnerSettings } from "@/components/owner-settings";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const pages: Record<string, React.ReactNode> = { companies: <MyCompanies/>, "create-company": <CompanyWizard/>, branding: <LegacyOwnerRoute feature="branding"/>, fields: <FieldBuilder/>, preview: <LegacyOwnerRoute feature="preview"/>, invitations: <LegacyOwnerRoute feature="invitations"/>, settings: <OwnerSettings/> };
  return pages[section] || notFound();
}
