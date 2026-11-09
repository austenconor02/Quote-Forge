import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accessibleEmailTextColor, invitationEmailBranding } from "../src/lib/invitation-email-branding";

test("email text reaches WCAG AA contrast on selected dark, light, and midtone brand colors", () => {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  for (const color of ["#122239", "#FFFFFF", "#FFAA00", "#285A6F", "#777777", "#00FF00", "#FF0000", "#0000FF", ...Array.from({length: 256}, (_, value) => "#" + value.toString(16).padStart(2, "0").repeat(3))]) {
    const text = accessibleEmailTextColor(color);
    const values = [luminance(color), luminance(text)].sort((a, b) => a - b);
    assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, color);
  }
  assert.equal(accessibleEmailTextColor("#122239"), "#FFFFFF");
  assert.equal(accessibleEmailTextColor("#FFAA00"), "#000000");
  assert.throws(() => accessibleEmailTextColor("red; background:url(untrusted)"));
});

test("template uses exactly the existing EmailJS variable names and supported conditional logo section", () => {
  const template = readFileSync("docs/emailjs-invitation-template.html", "utf8");
  const names = [...new Set([...template.matchAll(/{{[#/^]?([a-z_]+)}}/g)].map(match => match[1]))].sort();
  assert.deepEqual(names, ["to_email", "company_name", "company_logo_url", "primary_color", "header_text_color", "button_text_color", "invite_url", "expires_in"].sort());
  assert.ok(template.includes("{{#company_logo_url}}") && template.includes("{{/company_logo_url}}"));
  const branding = invitationEmailBranding("#ffaA00", "https://example.test/logo.png");
  assert.equal(branding.primaryColor, "#FFAA00");
  assert.equal(branding.headerTextColor, branding.buttonTextColor);
});
