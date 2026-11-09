import { jsPDF } from "jspdf";
import type { Company, Quote } from "./models";
import { money, readableText } from "./models";
import { calculateQuote } from "./quote";

type ProposalItem = ReturnType<typeof calculateQuote>["items"][number];
const usd = (value: number, digits: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

/** Customer unit rates derive from the final allocated amount, never the private base price. */
export function formatProposalUnitPrice(item: Pick<ProposalItem, "quantity" | "amount">) {
  if (!(item.quantity > 0)) return "—";
  const rate = item.amount / item.quantity;
  for (let digits = 2; digits <= 10; digits++) {
    const rounded = Number(rate.toFixed(digits));
    if (Math.round(rounded * item.quantity * 100) === Math.round(item.amount * 100)) return usd(rounded, digits);
  }
  return usd(rate, 10);
}

export function proposalReference(quote: Quote) {
  const createdAt = (quote as Quote & { createdAt?: string }).createdAt || quote.updatedAt;
  const date = new Date(createdAt);
  return {
    number: quote.id.startsWith("sample-") ? "PREVIEW" : `QF-${quote.id.toUpperCase()}`,
    date: Number.isNaN(date.valueOf()) ? "Date pending" : new Intl.DateTimeFormat("en-US", {month: "2-digit", day: "2-digit", year: "numeric", timeZone: "America/Chicago"}).format(date)
  };
}

export function createProposalPdf(company: Company, quote: Quote) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const right = pageWidth - margin;
  const width = right - margin;
  const theme = company.branding;
  const font = theme.font === "Georgia" ? "times" : "helvetica";
  const totals = calculateQuote(quote);
  const reference = proposalReference(quote);
  const ink = "#243346";
  const muted = "#6E7B8C";
  const rule = "#DFE5EB";
  const lineHeight = 11;

  pdf.setFont(font, "bold"); pdf.setFontSize(11.5);
  const companyX = theme.logo ? 185 : margin;
  const companyLines = pdf.splitTextToSize(company.name || "Company", right - companyX) as string[];
  const headerHeight = Math.max(112, 50 + companyLines.length * 13 + 37);
  pdf.setFont(font, "normal"); pdf.setFontSize(7.5);
  const contact = [company.name, company.address, company.phone, company.email, company.website].filter(Boolean).join(" · ");
  const contactLines = pdf.splitTextToSize(contact, width - 60) as string[];
  const footerHeight = Math.max(35, contactLines.length * 10 + 18);
  const bodyBottom = pageHeight - footerHeight - 24;
  const bodyTop = headerHeight + 24;
  if (bodyBottom - bodyTop < 200) throw new Error("Company contact details are too long for a proposal page.");

  function fitted(text: string, x: number, y: number, maxWidth: number, size = 8.5, align: "left" | "right" = "left") {
    let fontSize = size;
    pdf.setFontSize(fontSize);
    while (pdf.getTextWidth(text) > maxWidth && fontSize > 5) {fontSize -= .25; pdf.setFontSize(fontSize);}
    pdf.text(text, x, y, {align});
  }
  function header() {
    pdf.setFillColor(theme.primary); pdf.rect(0, 0, pageWidth, headerHeight, "F");
    if (theme.logo) {
      if (!/^data:image\/(png|jpeg|webp);base64,/i.test(theme.logo)) throw new Error("Load the company logo as a PNG, JPEG, or WebP image before exporting.");
      const image = pdf.getImageProperties(theme.logo);
      const ratio = Math.min(118 / image.width, 72 / image.height);
      const imageWidth = image.width * ratio, imageHeight = image.height * ratio;
      pdf.addImage(theme.logo, image.fileType, margin + (118 - imageWidth) / 2, 18 + (72 - imageHeight) / 2, imageWidth, imageHeight, undefined, "FAST");
    }
    pdf.setFont(font, "bold"); pdf.setTextColor(readableText(theme.primary)); pdf.setFontSize(11.5);
    companyLines.forEach((line, index) => pdf.text(line, companyX, 37 + index * 13));
    pdf.setFontSize(27); pdf.text("Project Proposal", companyX, Math.max(80, 37 + companyLines.length * 13 + 28));
  }
  header();
  let y = bodyTop;
  function newPage() {pdf.addPage(); header(); y = bodyTop;}
  function ensureSpace(height: number) {if (y + height > bodyBottom) newPage();}
  function paragraph(text: string, options: {x?: number; maxWidth?: number; size?: number; color?: string; bold?: boolean; leading?: number} = {}) {
    const size = options.size ?? 9, leading = options.leading ?? 12;
    pdf.setFont(font, options.bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(options.color ?? ink);
    const lines = pdf.splitTextToSize(text, options.maxWidth ?? width) as string[];
    for (const line of lines) {ensureSpace(leading); pdf.setFont(font, options.bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(options.color ?? ink); pdf.text(line, options.x ?? margin, y); y += leading;}
  }

  pdf.setTextColor(theme.primary); pdf.setFont(font, "bold"); pdf.setFontSize(11);
  pdf.text("Prepared For", margin, y + 11);
  pdf.setFont(font, "normal"); pdf.setFontSize(9); pdf.setTextColor(muted);
  const preparedY = y;
  const metadataX = right - 165;
  const numberLines = pdf.splitTextToSize(`Proposal #: ${reference.number}`, 165) as string[];
  numberLines.forEach((line, index) => pdf.text(line, metadataX, y + 11 + index * 12));
  pdf.text(`Date: ${reference.date}`, metadataX, y + 11 + numberLines.length * 12 + 5);
  y += 34;
  paragraph(quote.customer.name || "Customer", {size: 13, maxWidth: 300, leading: 16});
  const customerContact = [quote.customer.address, quote.customer.email, quote.customer.phone].filter(Boolean).join(" · ");
  if (customerContact) paragraph(customerContact, {size: 9, maxWidth: 300, color: muted});
  y = Math.max(y, preparedY + numberLines.length * 12 + 36) + 14;
  if (quote.title.trim()) paragraph(`Project: ${quote.title}`, {size: 10, color: theme.primary, bold: true, leading: 13});
  for (const field of company.fields) {
    const value = quote.customValues[field.id] ?? field.defaultValue;
    if (value === "" || value === undefined) continue;
    const formatted = field.type === "Checkbox" ? value === true || value === "true" ? "Yes" : "No" : String(value);
    paragraph(`${field.label}: ${formatted}`, {size: 9, color: muted, leading: 12});
  }
  y += 12; ensureSpace(50);
  pdf.setDrawColor(theme.accent); pdf.setLineWidth(1.5); pdf.line(margin, y, right, y);
  y += 30; pdf.setFont(font, "bold"); pdf.setTextColor(theme.primary); pdf.setFontSize(16); pdf.text("Detailed Scope of Work", margin, y); y += 22;

  function tableHeading(section: string, continued = false) {
    pdf.setFont(font, "bold"); pdf.setFontSize(10);
    const titleLines = pdf.splitTextToSize(section + (continued ? " (continued)" : ""), width - 20) as string[];
    const titleHeight = Math.max(26, titleLines.length * 12 + 14);
    if (titleHeight + 24 + 34 > bodyBottom - bodyTop) throw new Error("A proposal section title is too long for a page.");
    pdf.setFillColor(theme.primary); pdf.rect(margin, y, width, titleHeight, "F");
    pdf.setTextColor(readableText(theme.primary));
    titleLines.forEach((line, index) => pdf.text(line, margin + 10, y + 17 + index * 12));
    y += titleHeight;
    pdf.setFillColor(theme.secondary); pdf.rect(margin, y, width, 24, "F");
    pdf.setTextColor(readableText(theme.secondary)); pdf.setFontSize(8);
    pdf.text("Description", margin + 10, y + 16);
    pdf.text("Qty", 347, y + 16, {align: "right"});
    pdf.text("Unit Price", 444, y + 16, {align: "right"});
    pdf.text("Amount", right - 10, y + 16, {align: "right"});
    y += 24;
  }
  function continueTable(section: string) {newPage(); tableHeading(section, true);}
  for (const section of [...new Set(totals.items.map(item => item.section || "Scope Items"))]) {
    pdf.setFont(font, "bold"); pdf.setFontSize(10);
    const titleLines = pdf.splitTextToSize(section, width - 20) as string[];
    ensureSpace(Math.max(26, titleLines.length * 12 + 14) + 24 + 54);
    tableHeading(section);
    const items = totals.items.filter(item => (item.section || "Scope Items") === section);
    for (const item of items) {
      pdf.setFont(font, "normal"); pdf.setFontSize(8.5);
      const lines = pdf.splitTextToSize(item.description || "Line item", 235) as string[];
      const completeHeight = Math.max(34, lines.length * lineHeight + 16);
      const maxFreshRowHeight = bodyBottom - bodyTop - 65;
      if (completeHeight <= maxFreshRowHeight && y + completeHeight > bodyBottom) continueTable(section);
      let offset = 0;
      while (offset < lines.length) {
        if (bodyBottom - y < 34) continueTable(section);
        const capacity = Math.max(1, Math.floor((bodyBottom - y - 16) / lineHeight));
        const chunk = lines.slice(offset, offset + capacity);
        const rowHeight = Math.max(34, chunk.length * lineHeight + 16);
        pdf.setDrawColor(rule); pdf.setLineWidth(.5); pdf.rect(margin, y, width, rowHeight);
        pdf.setTextColor(ink); pdf.setFont(font, "normal"); pdf.setFontSize(8.5);
        chunk.forEach((line, index) => pdf.text(line, margin + 10, y + 14 + index * lineHeight));
        if (offset === 0) {
          pdf.setFont(font, "bold");
          fitted(`${item.quantity} ${item.unit}`, 347, y + 14, 48, 8.5, "right");
          fitted(formatProposalUnitPrice(item), 444, y + 14, 82, 8.5, "right");
          fitted(money(item.amount), right - 10, y + 14, 94, 8.5, "right");
        }
        y += rowHeight; offset += chunk.length;
        if (offset < lines.length) continueTable(section);
      }
    }
    if (y + 24 > bodyBottom) continueTable(section);
    pdf.setFillColor(theme.secondary); pdf.rect(margin, y, width, 24, "F");
    pdf.setTextColor(readableText(theme.secondary)); pdf.setFont(font, "bold"); pdf.setFontSize(9);
    pdf.text("Section Subtotal", margin + 10, y + 16);
    pdf.text(money(items.reduce((total, item) => total + item.amount, 0)), right - 10, y + 16, {align: "right"});
    y += 42;
  }
  if (!totals.items.length) {paragraph("No scope items have been added.", {color: muted}); y += 15;}

  ensureSpace(105);
  pdf.setFillColor(theme.secondary); pdf.roundedRect(right - 220, y, 220, 88, 7, 7, "F");
  pdf.setTextColor(readableText(theme.secondary)); pdf.setFont(font, "normal"); pdf.setFontSize(10);
  pdf.text("Subtotal", right - 202, y + 21); pdf.text(money(totals.net), right - 17, y + 21, {align: "right"});
  pdf.text(`Tax (${quote.taxRate}%)`, right - 202, y + 41); pdf.text(money(totals.tax), right - 17, y + 41, {align: "right"});
  pdf.setDrawColor(theme.accent); pdf.line(right - 202, y + 52, right - 17, y + 52);
  pdf.setFont(font, "bold"); pdf.setFontSize(12); pdf.text("Total", right - 202, y + 73);
  fitted(money(totals.total), right - 17, y + 73, 140, 14, "right"); y += 112;

  function panelHeading(title: string) {
    pdf.setFillColor(theme.primary); pdf.rect(margin, y, width, 28, "F");
    pdf.setTextColor(readableText(theme.primary)); pdf.setFont(font, "bold"); pdf.setFontSize(11); pdf.text(title, margin + 10, y + 18); y += 28;
  }
  pdf.setFont(font, "normal"); pdf.setFontSize(9);
  const noteLines = quote.notes.trim() ? pdf.splitTextToSize(quote.notes, width - 20) as string[] : [""];
  let noteOffset = 0;
  while (noteOffset < noteLines.length) {
    ensureSpace(70); panelHeading(noteOffset ? "Notes (continued)" : "Notes");
    const capacity = Math.max(1, Math.floor((bodyBottom - y - 20) / 12));
    const chunk = noteLines.slice(noteOffset, noteOffset + capacity);
    const height = Math.max(40, chunk.length * 12 + 20);
    pdf.setDrawColor(rule); pdf.setLineWidth(.5); pdf.rect(margin, y, width, height);
    pdf.setTextColor(ink); pdf.setFont(font, "normal"); pdf.setFontSize(9);
    chunk.forEach((line, index) => pdf.text(line, margin + 10, y + 17 + index * 12));
    y += height + 16; noteOffset += chunk.length;
    if (noteOffset < noteLines.length) newPage();
  }

  ensureSpace(110); panelHeading("Customer Approval");
  pdf.setDrawColor(rule); pdf.rect(margin, y, width, 82);
  pdf.setTextColor(ink); pdf.setFont(font, "normal"); pdf.setFontSize(9);
  pdf.text("By signing below, customer approves the project proposal described above.", margin + 10, y + 20);
  pdf.text("Signature:", margin + 10, y + 58); pdf.line(121, y + 54, 320, y + 54);
  pdf.text("Date:", 345, y + 58); pdf.line(373, y + 54, right - 15, y + 54);

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page); pdf.setDrawColor(rule); pdf.setLineWidth(.5); pdf.line(margin, bodyBottom + 17, right, bodyBottom + 17);
    pdf.setTextColor(muted); pdf.setFont(font, "normal"); pdf.setFontSize(7.5);
    contactLines.forEach((line, index) => pdf.text(line, margin, bodyBottom + 32 + index * 10));
    pdf.text(`Page ${page} of ${totalPages}`, right, pageHeight - 24, {align: "right"});
  }
  pdf.setProperties({title: `${company.name} - ${quote.title || "Project Proposal"}`, subject: "Customer proposal", author: company.name});
  return pdf;
}
