/**
 * AgentSandbox — ArrowJS Sandbox wrapper for safe agent output rendering.
 *
 * Agent outputs (LLM-generated HTML, SVG, JSON, etc.) are untrusted and
 * must be rendered in a sandbox. ArrowJS Sandbox provides an isolated
 * JS context with no access to the host DOM.
 *
 * Flow:
 *   1. Agent emits raw output (HTML/JSON/etc.)
 *   2. Meta Harness validates and redacts
 *   3. AgentSandbox compiles output to a render function
 *   4. Render function is invoked in the sandbox with a controlled API
 *   5. Output is captured and rendered to the host DOM
 */

export interface SandboxRenderResult {
  /** HTML string to inject into the host DOM */
  html: string;
  /** Optional CSS to inject */
  css?: string;
  /** Optional metadata about the render */
  metadata?: Record<string, unknown>;
}

export interface SandboxOptions {
  /** Max execution time for the render function, in ms */
  timeoutMs?: number;
  /** Max memory (bytes) the sandbox can allocate */
  maxMemoryBytes?: number;
  /** Allowed host API surface (functions exposed to the sandbox) */
  allowedApis?: string[];
}

export class AgentSandbox {
  private arrowSandbox: typeof import('@arrow-js/sandbox') | null = null;
  private defaultOptions: SandboxOptions = {
    timeoutMs: 1000,
    maxMemoryBytes: 16 * 1024 * 1024, // 16 MB
    allowedApis: [],
  };

  async init(): Promise<void> {
    this.arrowSandbox = await import('@arrow-js/sandbox');
  }

  /** Compile and execute an agent's render function in the sandbox. */
  async render(code: string, data: unknown, options?: SandboxOptions): Promise<SandboxRenderResult> {
    if (!this.arrowSandbox) {
      throw new Error('AgentSandbox not initialized — call init() first');
    }
    const opts = { ...this.defaultOptions, ...options };
    const sandbox = this.arrowSandbox.createSandbox({
      timeout: opts.timeoutMs,
      memoryLimit: opts.maxMemoryBytes,
    });
    try {
      // Expose only allowed APIs
      const ctx: Record<string, unknown> = { data };
      for (const api of opts.allowedApis ?? []) {
        // Real impl would map api name -> host function
      }
      const result = await sandbox.execute(code, ctx);
      if (typeof result !== 'object' || result === null) {
        return { html: String(result) };
      }
      const r = result as Record<string, unknown>;
      return {
        html: typeof r.html === 'string' ? r.html : '',
        css: typeof r.css === 'string' ? r.css : undefined,
        metadata: typeof r.metadata === 'object' && r.metadata !== null
          ? r.metadata as Record<string, unknown>
          : undefined,
      };
    } finally {
      sandbox.dispose();
    }
  }
}
