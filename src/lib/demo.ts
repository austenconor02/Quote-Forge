import { Company, Workspace, defaultBranding } from "./models";
import { sampleQuote } from "./quote";

export const demoCompanies: Company[] = [
  { id: "northstar-roofing", name: "Northstar Roofing", industry: "Roofing & exteriors", email: "hello@northstar.example", phone: "(512) 555-0101", address: "420 Barton Springs Rd, Austin, TX 78704", website: "https://northstar.example", status: "Active", branding: { ...defaultBranding }, fields: [{ id: "project-type", label: "Project type", type: "Dropdown", required: true, defaultValue: "Roof replacement", options: ["Roof replacement", "Roof repair", "Exterior renovation"] }, { id: "project-start", label: "Estimated start date", type: "Date", required: false, defaultValue: "", options: [] }], createdAt: "2026-11-01T12:00:00Z" },
  { id: "oak-and-stone", name: "Oak & Stone", industry: "Home remodeling", email: "team@oakstone.example", phone: "(512) 555-0102", address: "2500 South Lamar Blvd, Austin, TX", website: "https://oakstone.example", status: "Active", branding: { ...defaultBranding, primary: "#6B4B36", secondary: "#F7F2EC", accent: "#B88045", font: "Georgia" }, fields: [], createdAt: "2026-11-02T12:00:00Z" },
  { id: "volt-electric", name: "Volt Electric", industry: "Electrical services", email: "office@volt.example", phone: "(512) 555-0103", address: "720 Congress Ave, Austin, TX", website: "https://volt.example", status: "Active", branding: { ...defaultBranding, primary: "#243E75", secondary: "#EEF2FC", accent: "#E7AE3B" }, fields: [], createdAt: "2026-11-03T12:00:00Z" },
  { id: "evergreen-landscapes", name: "Evergreen Landscapes", industry: "Landscaping & outdoors", email: "hello@evergreen.example", phone: "(512) 555-0104", address: "3101 Bee Cave Rd, Austin, TX", website: "https://evergreen.example", status: "Draft", branding: { ...defaultBranding, primary: "#416545", secondary: "#EFF5EB", accent: "#A1AD69" }, fields: [], createdAt: "2026-11-04T12:00:00Z" },
  { id: "clearflow-plumbing", name: "Clearflow Plumbing", industry: "Plumbing services", email: "service@clearflow.example", phone: "(512) 555-0105", address: "6800 Burnet Rd, Austin, TX", website: "https://clearflow.example", status: "Active", branding: { ...defaultBranding, primary: "#17677D", secondary: "#EAF6F9", accent: "#E6A462" }, fields: [], createdAt: "2026-11-05T12:00:00Z" },
  { id: "summit-construction", name: "Summit Construction", industry: "General contracting", email: "build@summit.example", phone: "(512) 555-0106", address: "901 East 6th St, Austin, TX", website: "https://summit.example", status: "Suspended", branding: { ...defaultBranding, primary: "#3A4151", secondary: "#F0F1F4", accent: "#B36F41" }, fields: [], createdAt: "2026-11-06T12:00:00Z" }
];
export function makeDemoWorkspace(): Workspace {
  const companies = structuredClone(demoCompanies);
  return { version: 1, companies, selectedCompanyId: companies[0].id,
    customers: companies.slice(0, 3).map(c => sampleQuote(c).customer),
    drafts: [sampleQuote(companies[0]), sampleQuote(companies[1])],
    invitations: [{ id: "invite-1", companyId: companies[0].id, email: "chris@northstar.example", status: "Active", createdAt: "2026-11-07T15:00:00Z" }, { id: "invite-2", companyId: companies[1].id, email: "sam@oakstone.example", status: "Active", createdAt: "2026-11-06T15:00:00Z" }, { id: "invite-3", companyId: companies[3].id, email: "taylor@evergreen.example", status: "Prepared", createdAt: "2026-11-08T13:00:00Z" }],
    activity: [
      { id: "activity-1", title: "Evergreen Landscapes is taking shape", description: "Company workspace created as a draft", at: "2026-11-08T14:00:00Z", kind: "company" },
      { id: "activity-2", title: "A fresh look for Northstar Roofing", description: "Branding and proposal colors updated", at: "2026-11-08T12:30:00Z", kind: "branding" },
      { id: "activity-3", title: "Oak & Stone is ready to quote", description: "Company access activated for Sam", at: "2026-11-07T15:00:00Z", kind: "invite" }
    ] };
}
