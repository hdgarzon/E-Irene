export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type EmailMode = "log" | "resend";

export interface EmailProvider {
  readonly mode: EmailMode;
  send(msg: EmailMessage): Promise<{ id: string }>;
}
