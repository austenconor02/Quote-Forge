"use client";
import { ReactNode, useEffect, useRef } from "react";
import Image from "next/image";
import { X, ArrowUpRight, Hexagon } from "lucide-react";
import { Company, initials } from "@/lib/models";

export function Wordmark() { return <div className="wordmark"><span className="forge-logo"><Image src="/brand/quoteforge-logo-256.webp" alt="QuoteForge finance anvil logo" width={256} height={256} preload unoptimized/></span><span>Quote<span className="wordmark-forge">Forge</span><small>THE PLATFORM, YOUR POSSIBILITIES.</small></span></div>; }
export function CompanyLogo({ company, size = "" }: { company: Company; size?: string }) { return <span className={`company-logo ${size}`} style={{ background: company.branding.secondary, color: company.branding.primary }}>{company.branding.logo ? <img src={company.branding.logo} alt={`${company.name} logo`} /> : initials(company.name)}</span>; }
export function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}><span/>{value}</span>; }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{action}</div>; }
export function EmptyState({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><Hexagon size={32}/><h3>{title}</h3><p>{children}</p></div>; }
export function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function SmallArrow() { return <ArrowUpRight size={15}/>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog className="modal" ref={ref} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}</dialog>;
}
