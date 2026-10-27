/**
 * Report share tokens (ReportShare.token): 24 random bytes as hex. Shared by
 * the server (which issues them) and /free-report/result (which accepts one in
 * place of an audit id), so it imports nothing.
 */
export const REPORT_SHARE_TOKEN_RE = /^[a-f0-9]{48}$/;

export function isReportShareToken(value: string | null | undefined): value is string {
  return !!value && REPORT_SHARE_TOKEN_RE.test(value);
}
