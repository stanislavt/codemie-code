/**
 * Abstract base class for all RemoteToolkit implementations.
 */

import type { RemoteTool, RemoteToolkit } from './types.js';

export abstract class BaseRemoteToolkit implements RemoteToolkit {
  abstract readonly label: string;
  readonly description?: string;
  abstract getTools(): RemoteTool[];
}
