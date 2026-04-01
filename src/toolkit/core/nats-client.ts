/**
 * NATS Client for the CodeMie Toolkit subsystem.
 *
 * Connects to a NATS broker using a PLUGIN_KEY bearer token, registers toolkit tools,
 * and handles tool schema discovery (GET) and tool execution (RUN) via protobuf messages.
 *
 * NATS subject patterns:
 *   {plugin_key}.list         → GET handler (tool schema discovery)
 *   {plugin_key}.live.reply   → heartbeat ACK
 *   {plugin_key}.*.*.*        → RUN handler (tool execution: key.sessionId.label.toolName)
 *
 * Sends live updates to {plugin_key}.live every 60 seconds.
 */

import {
  connect,
  NatsConnection,
  Subscription,
  Msg,
  StringCodec,
} from 'nats';
import { logger } from '../../utils/logger.js';
import {
  decodeServiceRequest,
  encodeServiceResponse,
  Handler,
  Puppet,
  IServiceResponse,
} from '../proto/service.js';
import type { RemoteTool, PluginConfig } from './types.js';

const HEARTBEAT_INTERVAL_MS = 60_000;

export class NatsClient {
  private nc!: NatsConnection;
  private subscriptions: Subscription[] = [];
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private sc = StringCodec();

  constructor(
    private readonly config: PluginConfig,
    private readonly tools: RemoteTool[]
  ) {}

  async connect(): Promise<void> {
    logger.debug('NatsClient: connecting', { uri: this.config.engineUri });

    this.nc = await connect({
      servers: this.config.engineUri,
      token: this.config.pluginKey,
    });

    const key = this.config.pluginKey;

    // Subscribe: tool schema discovery (GET)
    const listSub = this.nc.subscribe(`${key}.list`);
    this.subscriptions.push(listSub);
    this.listenList(listSub);

    // Subscribe: heartbeat ACK
    const liveSub = this.nc.subscribe(`${key}.live.reply`);
    this.subscriptions.push(liveSub);
    // live.reply is fire-and-forget — no handler needed

    // Subscribe: tool execution (wildcard: key.sessionId.label.toolName)
    const runSub = this.nc.subscribe(`${key}.*.*.*`);
    this.subscriptions.push(runSub);
    this.listenRun(runSub);

    // Start heartbeat
    this.heartbeatTimer = setInterval(
      () => void this.sendLiveUpdate(),
      HEARTBEAT_INTERVAL_MS
    );

    logger.debug('NatsClient: connected and subscribed');
  }

  async disconnect(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    if (this.nc) {
      await this.nc.drain();
    }
    logger.debug('NatsClient: disconnected');
  }

  /**
   * Listens for GET requests on {key}.list — replies with tool schema.
   */
  private async listenList(sub: Subscription): Promise<void> {
    for await (const msg of sub) {
      void this.handleList(msg);
    }
  }

  /**
   * Listens for RUN requests on {key}.*.*.* — executes tool and replies.
   */
  private async listenRun(sub: Subscription): Promise<void> {
    for await (const msg of sub) {
      void this.handleRun(msg);
    }
  }

  /**
   * GET handler — tool schema discovery.
   * Decodes request, finds matching tool by name from subject, replies with JSON schema.
   */
  private async handleList(msg: Msg): Promise<void> {
    if (!msg.reply) return;

    try {
      const request = await decodeServiceRequest(msg.data);
      const toolName = this.extractToolNameFromSubject(request.meta?.subject ?? msg.subject);
      const tool = this.findTool(toolName);

      if (!tool) {
        logger.debug(`NatsClient: tool not found for subject '${msg.subject}'`);
        return;
      }

      const response: IServiceResponse = {
        meta: {
          subject: msg.subject,
          handler: Handler.GET,
          puppet: Puppet.LANGCHAIN_TOOL,
        },
        puppet_response: {
          lc_tool: {
            name: `_${tool.metadata.name}`,
            description: tool.metadata.description ?? '',
            args_schema: JSON.stringify(tool.getArgsSchema()),
          },
        },
      };

      const encoded = await encodeServiceResponse(response);
      msg.respond(encoded);
    } catch (error) {
      logger.error('NatsClient: error in handleList', error);
    }
  }

  /**
   * RUN handler — tool execution.
   * Decodes request, extracts query JSON, runs tool.execute(), replies with result.
   */
  private async handleRun(msg: Msg): Promise<void> {
    if (!msg.reply) return;

    try {
      const request = await decodeServiceRequest(msg.data);
      const lcTool = request.puppet_request?.lc_tool;

      const toolName = this.extractToolNameFromSubject(msg.subject);
      const tool = this.findTool(toolName);

      if (!tool) {
        await this.respondError(msg, `Tool '${toolName}' not found`);
        return;
      }

      let input: Record<string, unknown> = {};
      if (lcTool?.query) {
        try {
          input = JSON.parse(lcTool.query) as Record<string, unknown>;
        } catch {
          await this.respondError(msg, `Invalid JSON in query: ${lcTool.query}`);
          return;
        }
      }

      logger.debug(`NatsClient: executing tool '${tool.metadata.name}'`);

      const result = await tool.execute(input);

      const response: IServiceResponse = {
        meta: {
          subject: msg.subject,
          handler: Handler.RUN,
          puppet: Puppet.LANGCHAIN_TOOL,
        },
        puppet_response: {
          lc_tool: { result },
        },
      };

      const encoded = await encodeServiceResponse(response);
      msg.respond(encoded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.respondError(msg, message);
      logger.error('NatsClient: error in handleRun', error);
    }
  }

  /**
   * Responds with an error ServiceResponse.
   */
  private async respondError(msg: Msg, errorMessage: string): Promise<void> {
    if (!msg.reply) return;
    try {
      const response: IServiceResponse = {
        meta: { subject: msg.subject, handler: Handler.RUN, puppet: Puppet.LANGCHAIN_TOOL },
        error: errorMessage,
      };
      const encoded = await encodeServiceResponse(response);
      msg.respond(encoded);
    } catch {
      // best effort
    }
  }

  /**
   * Publishes a live update heartbeat to {plugin_key}.live.
   * Includes a JSON list of registered tool subjects.
   */
  private async sendLiveUpdate(): Promise<void> {
    try {
      const key = this.config.pluginKey;
      const toolSubjects = this.tools.map(
        t => `${key}.*._default._${t.metadata.name}`
      );
      this.nc.publish(`${key}.live`, this.sc.encode(JSON.stringify(toolSubjects)));
      logger.debug('NatsClient: sent live update');
    } catch (error) {
      logger.debug('NatsClient: failed to send live update', error);
    }
  }

  /**
   * Extracts the tool name (last segment) from a NATS subject.
   * Subject format: {key}.{sessionId}.{label}.{_toolName}
   */
  private extractToolNameFromSubject(subject: string): string {
    const parts = subject.split('.');
    return parts[parts.length - 1] ?? '';
  }

  /**
   * Finds a tool by prefixed name (e.g. '_read_file') or bare name ('read_file').
   */
  private findTool(nameFromSubject: string): RemoteTool | undefined {
    return this.tools.find(
      t =>
        `_${t.metadata.name}` === nameFromSubject ||
        t.metadata.name === nameFromSubject
    );
  }
}
