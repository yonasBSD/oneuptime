import logger from "Common/Server/Utils/Logger";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import { ChildProcess, fork } from "child_process";
import path from "path";

interface WorkerConfig {
  script: string;
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  timeout: number;
  proxy?:
    | {
        server: string;
        username?: string | undefined;
        password?: string | undefined;
      }
    | undefined;
}

interface WorkerResult {
  logMessages: string[];
  scriptError?: string | undefined;
  result?: unknown | undefined;
  screenshots: Record<string, string>;
  executionTimeInMS: number;
}

// IPC messages: parent → worker
interface ExecuteMessage {
  type: "execute";
  id: string;
  config: WorkerConfig;
}

interface ShutdownMessage {
  type: "shutdown";
}

type ParentToWorkerMessage = ExecuteMessage | ShutdownMessage;

// IPC messages: worker → parent
interface ReadyMessage {
  type: "ready";
  browserType?: BrowserType | undefined;
}

interface ResultMessage {
  type: "result";
  id: string;
  data: WorkerResult;
}

interface ErrorMessage {
  type: "error";
  id: string;
  error: string;
}

type WorkerToParentMessage = ReadyMessage | ResultMessage | ErrorMessage;

const MAX_EXECUTIONS_PER_WORKER: number = 50;
const WORKER_IDLE_TIMEOUT_MS: number = 5 * 60 * 1000; // 5 minutes
const EXECUTION_TIMEOUT_BUFFER_MS: number = 30 * 1000; // 30s buffer beyond script timeout

interface PoolWorker {
  process: ChildProcess;
  busy: boolean;
  browserType?: BrowserType | undefined;
  executionCount: number;
  idleTimer?: ReturnType<typeof setTimeout> | undefined;
  pendingResolve?: ((value: WorkerResult) => void) | undefined;
  pendingReject?: ((reason: Error) => void) | undefined;
  pendingTimeoutTimer?: ReturnType<typeof setTimeout> | undefined;
  pendingId?: string | undefined;
  stderrOutput: string;
}

function getSanitizedEnv(): Record<string, string> {
  const safeKeys: string[] = [
    "PATH",
    "HOME",
    "NODE_ENV",
    "PLAYWRIGHT_BROWSERS_PATH",
    "HTTP_PROXY_URL",
    "http_proxy",
    "HTTPS_PROXY_URL",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
  ];

  const env: Record<string, string> = {};

  for (const key of safeKeys) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  return env;
}

let executionIdCounter: number = 0;

class SyntheticMonitorWorkerPool {
  private workers: PoolWorker[] = [];

  public constructor() {
    process.on("SIGTERM", () => {
      this.shutdown().catch((err: unknown) => {
        logger.error(
          `SyntheticMonitorWorkerPool: error during SIGTERM shutdown: ${err}`,
        );
      });
    });
  }

  public async execute(
    config: WorkerConfig,
    timeout: number,
  ): Promise<WorkerResult> {
    const worker: PoolWorker = this.findOrCreateWorker(config.browserType);

    // Clear idle timer since the worker is now busy
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = undefined;
    }

    worker.busy = true;
    worker.executionCount++;

    executionIdCounter++;
    const executionId: string = `exec-${executionIdCounter}`;

    return new Promise<WorkerResult>(
      (
        resolve: (value: WorkerResult) => void,
        reject: (reason: Error) => void,
      ) => {
        worker.pendingResolve = resolve;
        worker.pendingReject = reject;
        worker.pendingId = executionId;

        // Execution timeout: script timeout + buffer
        worker.pendingTimeoutTimer = setTimeout(() => {
          this.handleWorkerTimeout(worker);
        }, timeout + EXECUTION_TIMEOUT_BUFFER_MS);

        const message: ParentToWorkerMessage = {
          type: "execute",
          id: executionId,
          config: config,
        };

        try {
          worker.process.send(message);
        } catch (sendErr: unknown) {
          // IPC channel is broken — clean up and reject immediately
          this.clearWorkerPending(worker);
          worker.busy = false;
          this.removeWorker(worker);
          reject(
            new Error(
              `Failed to send config to worker: ${(sendErr as Error)?.message || String(sendErr)}`,
            ),
          );
        }
      },
    );
  }

  public async shutdown(): Promise<void> {
    logger.debug(
      `SyntheticMonitorWorkerPool: shutting down ${this.workers.length} workers`,
    );

    const shutdownPromises: Promise<void>[] = this.workers.map(
      (worker: PoolWorker) => {
        return this.shutdownWorker(worker);
      },
    );

    await Promise.allSettled(shutdownPromises);
    this.workers = [];
  }

  private findOrCreateWorker(browserType: BrowserType): PoolWorker {
    // 1. Find idle worker with matching browser type (fast path — reuses warm browser)
    const matchingIdle: PoolWorker | undefined = this.workers.find(
      (w: PoolWorker) => {
        return !w.busy && w.browserType === browserType;
      },
    );

    if (matchingIdle) {
      logger.debug(
        `SyntheticMonitorWorkerPool: reusing idle worker with matching ${browserType} browser`,
      );
      return matchingIdle;
    }

    // 2. Find any idle worker (will close/relaunch browser for different type)
    const anyIdle: PoolWorker | undefined = this.workers.find(
      (w: PoolWorker) => {
        return !w.busy;
      },
    );

    if (anyIdle) {
      logger.debug(
        `SyntheticMonitorWorkerPool: reusing idle worker (browser type change: ${anyIdle.browserType || "none"} → ${browserType})`,
      );
      return anyIdle;
    }

    // 3. No idle worker — fork a new one
    logger.debug(
      `SyntheticMonitorWorkerPool: forking new worker for ${browserType} (pool size: ${this.workers.length + 1})`,
    );
    return this.forkWorker();
  }

  private forkWorker(): PoolWorker {
    const workerPath: string = path.resolve(
      __dirname,
      "Monitors",
      "MonitorTypes",
      "SyntheticMonitorWorker",
    );

    const child: ChildProcess = fork(workerPath, [], {
      env: getSanitizedEnv(),
      execArgv: [...process.execArgv, "--max-old-space-size=256"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const worker: PoolWorker = {
      process: child,
      busy: false,
      browserType: undefined,
      executionCount: 0,
      stderrOutput: "",
    };

    // Capture stderr for debugging
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        worker.stderrOutput += data.toString();
        // Keep only last 2000 chars to prevent memory growth
        if (worker.stderrOutput.length > 2000) {
          worker.stderrOutput = worker.stderrOutput.slice(-2000);
        }
      });
    }

    // Handle messages from worker
    child.on("message", (msg: WorkerToParentMessage) => {
      this.handleWorkerMessage(worker, msg);
    });

    // Handle worker crash/exit
    child.on("exit", (exitCode: number | null, signal: string | null) => {
      this.handleWorkerExit(worker, exitCode, signal);
    });

    child.on("error", (err: Error) => {
      this.handleWorkerError(worker, err);
    });

    this.workers.push(worker);
    return worker;
  }

  private handleWorkerMessage(
    worker: PoolWorker,
    msg: WorkerToParentMessage,
  ): void {
    if (msg.type === "ready") {
      worker.browserType = msg.browserType;
      return;
    }

    if (msg.type === "result" && msg.id === worker.pendingId) {
      this.resolveWorkerExecution(worker, msg.data);
      return;
    }

    if (msg.type === "error" && msg.id === worker.pendingId) {
      this.rejectWorkerExecution(
        worker,
        new Error(msg.error || "Unknown worker error"),
      );
      return;
    }
  }

  private resolveWorkerExecution(
    worker: PoolWorker,
    result: WorkerResult,
  ): void {
    const resolve: ((value: WorkerResult) => void) | undefined =
      worker.pendingResolve;

    this.clearWorkerPending(worker);
    worker.busy = false;

    // Retire worker if it has exceeded execution limit
    if (worker.executionCount >= MAX_EXECUTIONS_PER_WORKER) {
      logger.debug(
        `SyntheticMonitorWorkerPool: retiring worker after ${worker.executionCount} executions`,
      );
      this.retireWorker(worker);
    } else {
      this.startIdleTimer(worker);
    }

    if (resolve) {
      resolve(result);
    }
  }

  private rejectWorkerExecution(worker: PoolWorker, error: Error): void {
    const reject: ((reason: Error) => void) | undefined =
      worker.pendingReject;

    this.clearWorkerPending(worker);
    worker.busy = false;
    this.startIdleTimer(worker);

    if (reject) {
      reject(error);
    }
  }

  private clearWorkerPending(worker: PoolWorker): void {
    if (worker.pendingTimeoutTimer) {
      clearTimeout(worker.pendingTimeoutTimer);
      worker.pendingTimeoutTimer = undefined;
    }
    worker.pendingResolve = undefined;
    worker.pendingReject = undefined;
    worker.pendingId = undefined;
  }

  private handleWorkerTimeout(worker: PoolWorker): void {
    logger.error(
      `SyntheticMonitorWorkerPool: worker execution timed out, killing worker`,
    );

    const reject: ((reason: Error) => void) | undefined =
      worker.pendingReject;

    this.clearWorkerPending(worker);
    this.removeWorker(worker);

    // Force kill the worker process
    try {
      worker.process.kill("SIGKILL");
    } catch {
      // ignore — process may have already exited
    }

    if (reject) {
      reject(new Error("Synthetic monitor worker execution timed out"));
    }
  }

  private handleWorkerExit(
    worker: PoolWorker,
    exitCode: number | null,
    signal: string | null,
  ): void {
    const stderrInfo: string = worker.stderrOutput.trim()
      ? `: ${worker.stderrOutput.trim().substring(0, 500)}`
      : "";

    logger.debug(
      `SyntheticMonitorWorkerPool: worker exited (code=${exitCode}, signal=${signal})${stderrInfo}`,
    );

    // If there's a pending execution, reject it
    if (worker.pendingReject) {
      const reject: (reason: Error) => void = worker.pendingReject;
      this.clearWorkerPending(worker);

      if (exitCode === null) {
        const signalInfo: string = signal ? ` (signal: ${signal})` : "";
        reject(
          new Error(
            `Synthetic monitor worker was terminated by the system${signalInfo}. ` +
              `This is usually caused by high memory usage or resource limits in the container${stderrInfo}`,
          ),
        );
      } else {
        reject(
          new Error(
            `Synthetic monitor worker exited unexpectedly with code ${exitCode}${stderrInfo}`,
          ),
        );
      }
    }

    this.removeWorker(worker);
  }

  private handleWorkerError(worker: PoolWorker, err: Error): void {
    logger.error(
      `SyntheticMonitorWorkerPool: worker error: ${err.message}`,
    );

    if (worker.pendingReject) {
      const reject: (reason: Error) => void = worker.pendingReject;
      this.clearWorkerPending(worker);
      reject(err);
    }

    this.removeWorker(worker);
  }

  private startIdleTimer(worker: PoolWorker): void {
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
    }

    worker.idleTimer = setTimeout(() => {
      if (!worker.busy) {
        logger.debug(
          `SyntheticMonitorWorkerPool: retiring idle worker (browserType=${worker.browserType || "none"})`,
        );
        this.retireWorker(worker);
      }
    }, WORKER_IDLE_TIMEOUT_MS);

    // Don't let idle timers prevent process exit
    if (worker.idleTimer.unref) {
      worker.idleTimer.unref();
    }
  }

  private retireWorker(worker: PoolWorker): void {
    this.removeWorker(worker);
    this.shutdownWorker(worker).catch((err: unknown) => {
      logger.error(
        `SyntheticMonitorWorkerPool: error retiring worker: ${err}`,
      );
    });
  }

  private removeWorker(worker: PoolWorker): void {
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = undefined;
    }

    const index: number = this.workers.indexOf(worker);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }
  }

  private async shutdownWorker(worker: PoolWorker): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      const forceKillTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        try {
          worker.process.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolve();
      }, 5000);

      if (forceKillTimer.unref) {
        forceKillTimer.unref();
      }

      worker.process.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      try {
        const shutdownMsg: ParentToWorkerMessage = { type: "shutdown" };
        worker.process.send(shutdownMsg);
      } catch {
        // IPC channel already closed — force kill
        try {
          worker.process.kill("SIGKILL");
        } catch {
          // ignore
        }
        clearTimeout(forceKillTimer);
        resolve();
      }
    });
  }
}

export default new SyntheticMonitorWorkerPool();
