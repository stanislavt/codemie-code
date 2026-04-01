/**
 * Notification toolkit tools — email via SMTP (nodemailer).
 */

import nodemailer from 'nodemailer';
import { BaseRemoteTool } from '../../core/base-tool.js';
import { ConfigurationError, ToolExecutionError } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';
import type { RemoteToolMetadata } from '../../core/types.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

const EMAIL_META: RemoteToolMetadata = {
  name: 'send_email',
  label: 'notification',
  description: 'Send an email via SMTP',
  reactDescription:
    'Use this to send email notifications. ' +
    'Input: to (string), subject (string), body (string), cc (optional string), attachment_path (optional string).',
};

export class EmailTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = EMAIL_META;

  constructor(private readonly smtp: SmtpConfig) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC email address (optional)' },
        attachment_path: { type: 'string', description: 'Path to file to attach (optional)' },
      },
      required: ['to', 'subject', 'body'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const to = String(input['to'] ?? '');
    const subject = String(input['subject'] ?? '');
    const body = String(input['body'] ?? '');
    const cc = input['cc'] ? String(input['cc']) : undefined;
    const attachmentPath = input['attachment_path'] ? String(input['attachment_path']) : undefined;

    if (!to || !subject || !body) {
      throw new ToolExecutionError('send_email', 'Fields to, subject, and body are required');
    }

    // Never log credentials
    logger.debug('EmailTool: creating SMTP transporter', { host: this.smtp.host, port: this.smtp.port });

    const transporter = nodemailer.createTransport({
      host: this.smtp.host,
      port: this.smtp.port,
      secure: this.smtp.secure ?? this.smtp.port === 465,
      auth: {
        user: this.smtp.user,
        pass: this.smtp.password,
      },
    });

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.smtp.user,
      to,
      subject,
      text: body,
    };

    if (cc) mailOptions.cc = cc;
    if (attachmentPath) {
      mailOptions.attachments = [{ path: attachmentPath }];
    }

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.debug('EmailTool: email sent', { messageId: info.messageId });
      return `Email sent successfully to ${to} (messageId: ${info.messageId})`;
    } catch (err) {
      throw new ToolExecutionError('send_email', `SMTP error: ${(err as Error).message}`);
    }
  }
}

/**
 * Builds SmtpConfig from environment variables or throws ConfigurationError.
 * Priority: env vars → provided defaults
 */
export function buildSmtpConfig(stored?: Partial<SmtpConfig>): SmtpConfig {
  const host = process.env['SMTP_HOST'] ?? stored?.host;
  const port = process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : stored?.port;
  const user = process.env['SMTP_USER'] ?? stored?.user;
  const password = process.env['SMTP_PASSWORD'] ?? stored?.password;

  if (!host || !port || !user || !password) {
    const missing = [
      !host && 'SMTP_HOST',
      !port && 'SMTP_PORT',
      !user && 'SMTP_USER',
      !password && 'SMTP_PASSWORD',
    ].filter(Boolean).join(', ');

    throw new ConfigurationError(
      `Missing SMTP configuration: ${missing}. ` +
      'Set via environment variables or: codemie plugins config set smtp<Field> <value>'
    );
  }

  return { host, port, user, password };
}
