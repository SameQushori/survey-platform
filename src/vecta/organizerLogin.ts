export function organizerLoginUrl(currentOrigin: string, configuredOrigin?: string): string {
  const targetOrigin = configuredOrigin?.trim().replace(/\/$/, '') || currentOrigin;
  return new URL('/login', targetOrigin).toString();
}

export function requiresOrganizerHandoff(currentOrigin: string, targetUrl: string): boolean {
  return new URL(targetUrl).origin !== new URL(currentOrigin).origin;
}
