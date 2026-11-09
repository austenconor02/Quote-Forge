import type { Metadata } from "next";
import { ProposalLanding } from "@/components/proposal-landing";

export const metadata: Metadata = {title: "Your proposal", description: "View and download your private project proposal.", robots: {index: false, follow: false}, referrer: "no-referrer"};
export default function ProposalPage() {return <ProposalLanding/>;}
