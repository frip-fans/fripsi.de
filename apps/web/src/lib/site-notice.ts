export const OFFICIAL_SITE_NOTICE_COOKIE = "frip_fan_official_notice";
export const OFFICIAL_SITE_NOTICE_STORAGE_KEY = "frip-fan:official-site-notice:acknowledged";
export const OFFICIAL_SITE_NOTICE_REOPEN_STORAGE_KEY = "frip-fan:official-site-notice:reopen-after-language-change";
export const OFFICIAL_SITE_NOTICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function serializeOfficialSiteNoticeCookie(secure: boolean): string {
  const secureAttribute = secure ? "; Secure" : "";
  return `${OFFICIAL_SITE_NOTICE_COOKIE}=yes; Path=/; Max-Age=${OFFICIAL_SITE_NOTICE_MAX_AGE_SECONDS}; SameSite=Lax${secureAttribute}`;
}
