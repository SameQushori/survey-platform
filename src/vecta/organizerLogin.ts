export function organizerLoginUrl(currentOrigin: string, configuredOrigin?: string): string {
  const targetOrigin = configuredOrigin?.trim().replace(/\/$/, '') || currentOrigin;
  return new URL('/login', targetOrigin).toString();
}

export function requiresOrganizerHandoff(currentOrigin: string, targetUrl: string): boolean {
  return new URL(targetUrl).origin !== new URL(currentOrigin).origin;
}

export function organizerAuthDestination(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.startsWith('//')) return '/app';
  return /^\/app(?:[/?#]|$)/.test(candidate) ? candidate : '/app';
}

export function clerkErrorCode(reason: unknown): string {
  if (typeof reason !== 'object' || reason === null) return '';
  if ('code' in reason && typeof reason.code === 'string') return reason.code;
  if ('errors' in reason && Array.isArray(reason.errors)) {
    const firstError = reason.errors[0];
    if (typeof firstError === 'object' && firstError !== null && 'code' in firstError && typeof firstError.code === 'string') {
      return firstError.code;
    }
  }
  return '';
}

export function requiresSignUpTransfer(reason: unknown, isTransferable: boolean): boolean {
  return isTransferable || clerkErrorCode(reason) === 'sign_up_if_missing_transfer';
}
