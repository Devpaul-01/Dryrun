/** The URL a person can send to someone to view a shared playbook: https when a share origin is configured, else the app deep link. */
export function buildPlaybookShareUrl(token: string, shareBaseUrl: string): string {
  const base = shareBaseUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/playbook/${encodeURIComponent(token)}` : `dryrun://playbook/${encodeURIComponent(token)}`;
}
