import type { Company } from "./models";
export function tenantManifest(company: Company) {
  const scope = `/app/${encodeURIComponent(company.id)}/`;
  return {
    id: scope, name: company.name, short_name: company.name.slice(0, 24), start_url: scope, scope,
    display: "standalone", orientation: "any", background_color: company.branding.secondary, theme_color: company.branding.primary,
    description: `${company.name} — Your quoting workspace`,
    icons: [192, 512].map(size => ({src: `${scope}icons/${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable"}))
  };
}
