import { describe, expect, it, vi } from "vitest";

import { createAuthEmailSender } from "@/auth-email";

const message = {
  to: "operator@example.com",
  subject: "Your FieldClose access code",
  text: "Code: 123456",
};

describe("authentication email delivery", () => {
  it("prints auth messages only in a non-production development environment", async () => {
    const developmentLog = vi.fn();
    const fetcher = vi.fn<typeof fetch>();
    const sendEmail = createAuthEmailSender({
      delivery: null,
      nodeEnvironment: "development",
      developmentLog,
      fetcher,
    });

    await sendEmail(message);

    expect(fetcher).not.toHaveBeenCalled();
    expect(developmentLog).toHaveBeenCalledWith(
      expect.stringContaining("Code: 123456"),
    );
  });

  it("fails closed when production email delivery is not configured", async () => {
    const sendEmail = createAuthEmailSender({
      delivery: null,
      nodeEnvironment: "production",
      developmentLog: vi.fn(),
      fetcher: vi.fn<typeof fetch>(),
    });

    await expect(sendEmail(message)).rejects.toThrow(
      /not configured for production/u,
    );
  });

  it("delivers configured messages through the Resend HTTPS API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-test" }), { status: 200 }),
    );
    const sendEmail = createAuthEmailSender({
      delivery: {
        provider: "resend",
        apiKey: "resend-test-api-key",
        from: "FieldClose <access@fieldclose.example>",
      },
      nodeEnvironment: "production",
      fetcher,
    });

    await sendEmail(message);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resend-test-api-key",
          "User-Agent": "FieldClose/0.1.0",
        }),
        body: JSON.stringify({
          from: "FieldClose <access@fieldclose.example>",
          to: ["operator@example.com"],
          subject: message.subject,
          text: message.text,
        }),
      }),
    );
  });

  it("delivers configured messages through SMTP with required STARTTLS", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "smtp-test" });
    const smtpTransportFactory = vi.fn().mockReturnValue({ sendMail });
    const fetcher = vi.fn<typeof fetch>();
    const sendEmail = createAuthEmailSender({
      delivery: {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        username: "access@example.com",
        password: "smtp-test-credential",
        from: "FieldClose <access@example.com>",
        useTls: true,
        useSsl: false,
      },
      nodeEnvironment: "production",
      fetcher,
      smtpTransportFactory,
    });

    await sendEmail(message);

    expect(fetcher).not.toHaveBeenCalled();
    expect(smtpTransportFactory).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: "access@example.com",
        pass: "smtp-test-credential",
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "FieldClose <access@example.com>",
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  });

  it("does not expose SMTP provider details when delivery fails", async () => {
    const smtpTransportFactory = vi.fn().mockReturnValue({
      sendMail: vi
        .fn()
        .mockRejectedValue(new Error("credential smtp-test-credential failed")),
    });
    const sendEmail = createAuthEmailSender({
      delivery: {
        provider: "smtp",
        host: "smtp.example.com",
        port: 465,
        username: "access@example.com",
        password: "smtp-test-credential",
        from: "access@example.com",
        useTls: false,
        useSsl: true,
      },
      nodeEnvironment: "production",
      smtpTransportFactory,
    });

    await expect(sendEmail(message)).rejects.toThrow(
      "Authentication email delivery failed through SMTP.",
    );
  });

  it("does not expose provider response details when delivery fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider detail", { status: 403 }));
    const sendEmail = createAuthEmailSender({
      delivery: {
        provider: "resend",
        apiKey: "resend-test-api-key",
        from: "access@fieldclose.example",
      },
      nodeEnvironment: "production",
      fetcher,
    });

    await expect(sendEmail(message)).rejects.toThrow(
      "Authentication email delivery failed with status 403.",
    );
  });
});
