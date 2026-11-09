import { CompanyWizard } from "@/components/company-wizard";
export default async function EditCompanyPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{step?: string}> }) {
  const [{companyId}, query] = await Promise.all([params, searchParams]);
  const step = Number(query.step || 0);
  return <CompanyWizard key={companyId} companyId={companyId} initialStep={Number.isInteger(step) && step >= 0 && step <= 3 ? step : 0}/>;
}
