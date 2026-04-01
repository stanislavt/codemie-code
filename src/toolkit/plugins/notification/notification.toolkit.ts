/**
 * NotificationToolkit — email notification via SMTP.
 */

import { BaseRemoteToolkit } from '../../core/base-toolkit.js';
import type { RemoteTool } from '../../core/types.js';
import { EmailTool, buildSmtpConfig, type SmtpConfig } from './notification.tools.js';
import { ToolkitConfigLoader } from '../../core/config.js';

export class NotificationToolkit extends BaseRemoteToolkit {
  readonly label = 'notification';
  readonly description = 'Email notification toolkit via SMTP';

  private readonly smtp: SmtpConfig;

  constructor(smtp?: SmtpConfig) {
    super();
    // If smtp not explicitly provided, build from env vars + stored config
    const stored = ToolkitConfigLoader.load();
    this.smtp = smtp ?? buildSmtpConfig({
      host: stored.smtpHost,
      port: stored.smtpPort,
      user: stored.smtpUser,
      password: stored.smtpPassword,
    });
  }

  getTools(): RemoteTool[] {
    return [new EmailTool(this.smtp)];
  }
}
