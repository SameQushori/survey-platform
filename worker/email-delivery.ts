export interface TransactionalEmail {
  html: string;
  subject: string;
  text: string;
}

export type EmailProvider = "brevo" | "resend";

export class EmailProviderError extends Error {
  readonly provider: EmailProvider;
  readonly status: number;

  constructor(provider: EmailProvider, status: number) {
    super(`${provider} returned ${status}`);
    this.name = "EmailProviderError";
    this.provider = provider;
    this.status = status;
  }
}

interface Sender {
  email: string;
  name?: string;
}

function parseSender(value: string | undefined): Sender | null {
  const sender = value?.trim() ?? "";
  const named = /^(.*?)\s*<([^<>\s@]+@[^<>\s@]+)>$/.exec(sender);
  if (named) {
    const name = named[1]?.trim().replace(/^"|"$/g, "");
    return { email: named[2] ?? "", ...(name ? { name } : {}) };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(sender)) return { email: sender };
  return null;
}

function configuredProvider(env: Env): EmailProvider | null {
  if (!parseSender(env.AUTH_EMAIL_FROM)) return null;
  if (env.AUTH_EMAIL_PROVIDER === "brevo" && env.BREVO_API_KEY?.trim()) return "brevo";
  if (env.AUTH_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY?.trim()) return "resend";
  return null;
}

export function emailDeliveryConfigured(env: Env): boolean {
  return configuredProvider(env) !== null;
}

async function sendWithResend(
  env: Env,
  challengeId: string,
  recipient: string,
  message: TransactionalEmail,
  signal: AbortSignal,
): Promise<Response> {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": challengeId,
      "User-Agent": "Vecta/1.0 (+https://github.com/SameQushori/survey-platform)",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [recipient],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal,
  });
}

async function sendWithBrevo(
  env: Env,
  challengeId: string,
  recipient: string,
  message: TransactionalEmail,
  signal: AbortSignal,
): Promise<Response> {
  const sender = parseSender(env.AUTH_EMAIL_FROM);
  if (!sender) throw new Error("Email sender is not configured");
  return fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "api-key": env.BREVO_API_KEY ?? "",
      "Content-Type": "application/json",
      "User-Agent": "Vecta/1.0 (+https://github.com/SameQushori/survey-platform)",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: recipient }],
      subject: message.subject,
      htmlContent: message.html,
      headers: { "X-Vecta-Challenge": challengeId },
      tags: ["organizer-login"],
    }),
    signal,
  });
}

export async function sendTransactionalEmail(
  env: Env,
  challengeId: string,
  recipient: string,
  message: TransactionalEmail,
): Promise<EmailProvider> {
  const provider = configuredProvider(env);
  if (!provider) throw new Error("Email delivery is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = provider === "brevo"
      ? await sendWithBrevo(env, challengeId, recipient, message, controller.signal)
      : await sendWithResend(env, challengeId, recipient, message, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new EmailProviderError(provider, response.status);
  return provider;
}
