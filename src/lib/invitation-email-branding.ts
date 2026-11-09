export type InvitationEmailBranding = {companyLogoUrl: string; primaryColor: string; headerTextColor: string; buttonTextColor: string};
export type StoredInvitationCompany = {id: string; name: string; branding: {primary: string; logoStoragePath?: string}};

export function accessibleEmailTextColor(background: string): "#000000" | "#FFFFFF" {
  if (!/^#[a-f0-9]{6}$/i.test(background)) throw new Error("The company primary color must be a six-digit HEX color.");
  const channels = [1, 3, 5].map(index => {
    const value = parseInt(background.slice(index, index + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000000" : "#FFFFFF";
}

export function invitationEmailBranding(primary: string, companyLogoUrl: string): InvitationEmailBranding {
  const text = accessibleEmailTextColor(primary);
  return {companyLogoUrl, primaryColor: primary.toUpperCase(), headerTextColor: text, buttonTextColor: text};
}
