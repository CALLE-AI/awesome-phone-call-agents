import nodemailer from "nodemailer";

import type { ServerEnvironment } from "@/config/environment";

export interface AuthEmailMessage {
  to: string;
  subject: string;
  text: string;
}

interface AuthEmailSenderOptions {
  delivery: ServerEnvironment["authEmail"];
  nodeEnvironment: ServerEnvironment["nodeEnvironment"];
  fetcher?: typeof fetch;
  developmentLog?: (message: string) => void;
  smtpTransportFactory?: (
    options: AuthEmailSmtpTransportOptions,
  ) => AuthEmailSmtpTransport;
}

interface AuthEmailSmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: {
    user: string;
    pass: string;
  };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  disableFileAccess: boolean;
  disableUrlAccess: boolean;
}

interface AuthEmailSmtpTransport {
  sendMail(message: AuthEmailMessage & { from: string }): Promise<unknown>;
}

export function createAuthEmailSender({
  delivery,
  nodeEnvironment,
  fetcher = fetch,
  developmentLog = console.info,
  smtpTransportFactory = (options) => nodemailer.createTransport(options),
}: AuthEmailSenderOptions) {
  const smtpTransport =
    delivery?.provider === "smtp"
      ? smtpTransportFactory({
          host: delivery.host,
          port: delivery.port,
          secure: delivery.useSsl,
          requireTLS: delivery.useTls,
          auth: {
            user: delivery.username,
            pass: delivery.password,
          },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 30_000,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      : null;

  return async ({ to, subject, text }: AuthEmailMessage) => {
    if (!delivery) {
      if (nodeEnvironment === "production") {
        throw new Error(
          "Authentication email delivery is not configured for production.",
        );
      }

      developmentLog(
        [
          "[FieldClose development auth email]",
          `To: ${to}`,
          `Subject: ${subject}`,
          text,
        ].join("\n"),
      );
      return;
    }

    if (delivery.provider === "smtp") {
      try {
        await smtpTransport?.sendMail({
          from: delivery.from,
          to,
          subject,
          text,
        });
      } catch {
        throw new Error(
          "Authentication email delivery failed through SMTP.",
        );
      }
      return;
    }

    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${delivery.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "FieldClose/0.1.0",
      },
      body: JSON.stringify({
        from: delivery.from,
        to: [to],
        subject,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Authentication email delivery failed with status ${response.status}.`,
      );
    }
  };
}
