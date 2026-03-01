/*
 * Long-lived worker process for synthetic monitors.
 * Launched via child_process.fork() by SyntheticMonitorWorkerPool.
 * Keeps a warm Playwright browser between executions to save ~150MB + ~300ms per run.
 * Supports the new IPC protocol (execute/shutdown) and legacy protocol (plain WorkerConfig)
 * for backward compatibility.
 */

import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import BrowserUtil from "Common/Server/Utils/Browser";
import axios from "axios";
import crypto from "crypto";
import vm, { Context } from "node:vm";
import { Browser, BrowserContext, Page, chromium, firefox } from "playwright";

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

interface ProxyOptions {
  server: string;
  username?: string | undefined;
  password?: string | undefined;
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

// Warm browser state
let currentBrowser: Browser | null = null;
let currentBrowserType: BrowserType | null = null;
let currentProxyServer: string | null = null;

const MAX_BROWSER_LAUNCH_RETRIES: number = 3;
const BROWSER_LAUNCH_RETRY_DELAY_MS: number = 2000;

async function launchBrowserOnly(
  browserType: BrowserType,
  proxy?: WorkerConfig["proxy"],
): Promise<Browser> {
  let proxyOptions: ProxyOptions | undefined;

  if (proxy) {
    proxyOptions = {
      server: proxy.server,
    };

    if (proxy.username && proxy.password) {
      proxyOptions.username = proxy.username;
      proxyOptions.password = proxy.password;
    }
  }

  if (browserType === BrowserType.Chromium) {
    const launchOptions: Record<string, unknown> = {
      executablePath: await BrowserUtil.getChromeExecutablePath(),
      headless: true,
      args: BrowserUtil.chromiumStabilityArgs,
    };

    if (proxyOptions) {
      launchOptions["proxy"] = proxyOptions;
    }

    return chromium.launch(launchOptions);
  } else if (browserType === BrowserType.Firefox) {
    const launchOptions: Record<string, unknown> = {
      executablePath: await BrowserUtil.getFirefoxExecutablePath(),
      headless: true,
      firefoxUserPrefs: BrowserUtil.firefoxStabilityPrefs,
    };

    if (proxyOptions) {
      launchOptions["proxy"] = proxyOptions;
    }

    return firefox.launch(launchOptions);
  }

  throw new Error("Invalid Browser Type.");
}

async function launchBrowserWithRetry(
  browserType: BrowserType,
  proxy?: WorkerConfig["proxy"],
): Promise<Browser> {
  let lastError: Error | undefined;

  for (
    let attempt: number = 1;
    attempt <= MAX_BROWSER_LAUNCH_RETRIES;
    attempt++
  ) {
    try {
      return await launchBrowserOnly(browserType, proxy);
    } catch (err: unknown) {
      lastError = err as Error;

      if (attempt < MAX_BROWSER_LAUNCH_RETRIES) {
        await new Promise((resolve: (value: void) => void) => {
          setTimeout(resolve, BROWSER_LAUNCH_RETRY_DELAY_MS);
        });
      }
    }
  }

  throw new Error(
    `Failed to launch browser after ${MAX_BROWSER_LAUNCH_RETRIES} attempts. ` +
      `This is usually caused by insufficient memory in the container. ` +
      `Last error: ${lastError?.message || String(lastError)}`,
  );
}

let executionsSinceLastLaunch: number = 0;

async function ensureBrowser(config: WorkerConfig): Promise<Browser> {
  const configProxyServer: string | null = config.proxy?.server || null;

  // If we have a browser of the right type, same proxy, and it's still connected, reuse it
  if (
    currentBrowser &&
    currentBrowserType === config.browserType &&
    currentProxyServer === configProxyServer &&
    currentBrowser.isConnected()
  ) {
    // Active health check: verify the browser can actually create pages,
    // not just that the WebSocket connection is alive. This catches zombie
    // browsers where the process is alive but internally broken.
    let isHealthy: boolean = true;

    try {
      const healthContext: BrowserContext =
        await currentBrowser.newContext();
      const healthPage: Page = await healthContext.newPage();
      await healthPage.close();
      await healthContext.close();
    } catch {
      isHealthy = false;

      if (process.send) {
        try {
          process.send({
            type: "log",
            message: `[SyntheticMonitorWorker] Warm browser failed health check, will relaunch`,
          });
        } catch {
          // ignore
        }
      }

      try {
        if (currentBrowser.isConnected()) {
          await currentBrowser.close();
        }
      } catch {
        // ignore cleanup errors
      }
      currentBrowser = null;
      currentBrowserType = null;
      currentProxyServer = null;
    }

    if (isHealthy && currentBrowser) {
      executionsSinceLastLaunch++;
      if (process.send) {
        try {
          process.send({
            type: "log",
            message: `[SyntheticMonitorWorker] Reusing warm ${config.browserType} browser (execution #${executionsSinceLastLaunch} since launch)`,
          });
        } catch {
          // ignore
        }
      }
      return currentBrowser;
    }
  }

  // Close existing browser if type/proxy changed or browser crashed
  const reason: string = !currentBrowser
    ? "no browser"
    : currentBrowserType !== config.browserType
      ? `type change (${currentBrowserType} → ${config.browserType})`
      : currentProxyServer !== configProxyServer
        ? "proxy change"
        : "browser disconnected";

  if (process.send) {
    try {
      process.send({
        type: "log",
        message: `[SyntheticMonitorWorker] Launching new browser — reason: ${reason}`,
      });
    } catch {
      // ignore
    }
  }

  if (currentBrowser) {
    try {
      if (currentBrowser.isConnected()) {
        await currentBrowser.close();
      }
    } catch {
      // ignore cleanup errors
    }
    currentBrowser = null;
    currentBrowserType = null;
    currentProxyServer = null;
  }

  executionsSinceLastLaunch = 1;

  // Launch new browser
  currentBrowser = await launchBrowserWithRetry(
    config.browserType,
    config.proxy,
  );
  currentBrowserType = config.browserType;
  currentProxyServer = configProxyServer;

  // Notify parent of browser type for affinity matching
  sendMessage({
    type: "ready",
    browserType: currentBrowserType,
  });

  return currentBrowser;
}

const MAX_CONTEXT_CREATE_RETRIES: number = 3;
const CONTEXT_CREATE_RETRY_DELAY_MS: number = 1000;

async function createContextAndPage(
  config: WorkerConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const viewport: { height: number; width: number } =
    BrowserUtil.getViewportHeightAndWidth({
      screenSizeType: config.screenSizeType,
    });

  let lastError: Error | undefined;

  for (
    let attempt: number = 1;
    attempt <= MAX_CONTEXT_CREATE_RETRIES;
    attempt++
  ) {
    const browserStartTime: [number, number] = process.hrtime();
    const browser: Browser = await ensureBrowser(config);
    const browserElapsed: [number, number] = process.hrtime(browserStartTime);
    const browserMs: number = Math.ceil(
      (browserElapsed[0] * 1000000000 + browserElapsed[1]) / 1000000,
    );

    try {
      const context: BrowserContext = await browser.newContext({
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
      });

      const page: Page = await context.newPage();

      if (process.send) {
        try {
          process.send({
            type: "log",
            message: `[SyntheticMonitorWorker] Context+page created (attempt ${attempt}, ensureBrowser took ${browserMs}ms)`,
          });
        } catch {
          // ignore
        }
      }

      return { browser, context, page };
    } catch (err: unknown) {
      lastError = err as Error;

      if (process.send) {
        try {
          process.send({
            type: "log",
            message: `[SyntheticMonitorWorker] Context/page creation failed on attempt ${attempt}/${MAX_CONTEXT_CREATE_RETRIES}: ${(err as Error)?.message}. ensureBrowser took ${browserMs}ms`,
          });
        } catch {
          // ignore
        }
      }

      // Browser died between launch and context/page creation — close and force relaunch
      if (currentBrowser) {
        try {
          if (currentBrowser.isConnected()) {
            await currentBrowser.close();
          }
        } catch {
          // ignore cleanup errors
        }
      }
      currentBrowser = null;
      currentBrowserType = null;
      currentProxyServer = null;

      if (attempt < MAX_CONTEXT_CREATE_RETRIES) {
        await new Promise((resolve: (value: void) => void) => {
          setTimeout(resolve, CONTEXT_CREATE_RETRY_DELAY_MS);
        });
      }
    }
  }

  throw new Error(
    `Failed to create browser context/page after ${MAX_CONTEXT_CREATE_RETRIES} attempts. ` +
      `The browser may be crashing on startup due to insufficient memory or container restrictions. ` +
      `Last error: ${lastError?.message || String(lastError)}`,
  );
}

async function runExecution(config: WorkerConfig): Promise<WorkerResult> {
  const workerResult: WorkerResult = {
    logMessages: [],
    scriptError: undefined,
    result: undefined,
    screenshots: {},
    executionTimeInMS: 0,
  };

  let context: BrowserContext | null = null;

  try {
    const startTime: [number, number] = process.hrtime();

    const session: {
      browser: Browser;
      context: BrowserContext;
      page: Page;
    } = await createContextAndPage(config);

    const browser: Browser = session.browser;
    context = session.context;
    const page: Page = session.page;

    // Track browser disconnection so we can give a clear error
    let browserDisconnected: boolean = false;
    const disconnectHandler: () => void = (): void => {
      browserDisconnected = true;
    };
    browser.on("disconnected", disconnectHandler);

    // Set default timeouts so page operations don't hang indefinitely
    page.setDefaultTimeout(config.timeout);
    page.setDefaultNavigationTimeout(config.timeout);

    const logMessages: string[] = [];

    const sandbox: Context = {
      console: {
        log: (...args: unknown[]) => {
          logMessages.push(
            args
              .map((v: unknown) => {
                return typeof v === "object" ? JSON.stringify(v) : String(v);
              })
              .join(" "),
          );
        },
      },
      browser: browser,
      page: page,
      screenSizeType: config.screenSizeType,
      browserType: config.browserType,
      axios: axios,
      crypto: crypto,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
    };

    vm.createContext(sandbox);

    const script: string = `(async()=>{
      ${config.script}
    })()`;

    let returnVal: unknown;

    let scriptTimeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const scriptTimeoutPromise: Promise<never> = new Promise<never>(
      (_: (value: never) => void, reject: (reason: Error) => void) => {
        scriptTimeoutTimer = setTimeout(() => {
          reject(
            new Error(
              `Synthetic monitor script timed out after ${config.timeout}ms. ` +
                `Consider optimizing your script or increasing the timeout.`,
            ),
          );
        }, config.timeout);
      },
    );

    try {
      returnVal = await Promise.race([
        vm.runInContext(script, sandbox, {
          timeout: config.timeout,
        }),
        scriptTimeoutPromise,
      ]);
    } catch (scriptErr: unknown) {
      if (browserDisconnected) {
        throw new Error(
          "Browser crashed or was terminated during script execution. This is usually caused by high memory usage. Try simplifying the script or reducing the number of page navigations.",
        );
      }
      throw scriptErr;
    } finally {
      if (scriptTimeoutTimer) {
        clearTimeout(scriptTimeoutTimer);
      }
      browser.removeListener("disconnected", disconnectHandler);
    }

    const endTime: [number, number] = process.hrtime(startTime);
    const executionTimeInMS: number = Math.ceil(
      (endTime[0] * 1000000000 + endTime[1]) / 1000000,
    );

    workerResult.executionTimeInMS = executionTimeInMS;
    workerResult.logMessages = logMessages;

    // Capture return value before closing context to extract screenshots
    const returnObj: Record<string, unknown> =
      returnVal && typeof returnVal === "object"
        ? (returnVal as Record<string, unknown>)
        : {};

    // Close context (NOT browser) to free per-execution memory
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
      context = null;
    }

    /*
     * In --single-process mode, closing a context can destabilize the browser.
     * Proactively check health so the next execution doesn't waste time on a zombie.
     */
    if (currentBrowser && !currentBrowser.isConnected()) {
      currentBrowser = null;
      currentBrowserType = null;
      currentProxyServer = null;
    }

    // Convert screenshots from Buffer to base64
    if (returnObj["screenshots"]) {
      const screenshots: Record<string, unknown> = returnObj[
        "screenshots"
      ] as Record<string, unknown>;

      for (const screenshotName in screenshots) {
        if (!screenshots[screenshotName]) {
          continue;
        }

        if (!(screenshots[screenshotName] instanceof Buffer)) {
          continue;
        }

        const screenshotBuffer: Buffer = screenshots[screenshotName] as Buffer;
        workerResult.screenshots[screenshotName] =
          screenshotBuffer.toString("base64");
      }
    }

    workerResult.result = returnObj["data"];
  } catch (err: unknown) {
    workerResult.scriptError = (err as Error)?.message || String(err);
  } finally {
    // Close context if not already closed (error path) — leave browser warm
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore cleanup errors
      }
    }

    // Proactively detect zombie browser after context cleanup
    if (currentBrowser && !currentBrowser.isConnected()) {
      currentBrowser = null;
      currentBrowserType = null;
      currentProxyServer = null;
    }
  }

  return workerResult;
}

async function shutdownGracefully(): Promise<void> {
  if (currentBrowser) {
    try {
      // Close all contexts first
      const contexts: Array<BrowserContext> = currentBrowser.contexts();
      for (const ctx of contexts) {
        try {
          await ctx.close();
        } catch {
          // ignore
        }
      }
      if (currentBrowser.isConnected()) {
        await currentBrowser.close();
      }
    } catch {
      // ignore cleanup errors
    }
    currentBrowser = null;
    currentBrowserType = null;
    currentProxyServer = null;
  }
  process.exit(0);
}

function sendMessage(msg: ReadyMessage | ResultMessage | ErrorMessage): void {
  try {
    if (process.send) {
      process.send(msg);
    }
  } catch {
    // IPC channel closed — can't send. Worker will be cleaned up by pool timeout or exit handler.
  }
}

/*
 * Safety timeout for process.send() callback in legacy mode.
 */
const IPC_FLUSH_TIMEOUT_MS: number = 10000;

function handleLegacyMessage(config: WorkerConfig): void {
  /*
   * Legacy one-shot mode: receive a plain WorkerConfig (no `type` field),
   * run once, send result, exit. This maintains backward compatibility.
   */
  const safetyMarginMs: number = 15000;
  const globalSafetyTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
    const errorResult: WorkerResult = {
      logMessages: [],
      scriptError:
        "Synthetic monitor worker safety timeout reached. " +
        "The script or browser cleanup took too long. " +
        "Consider simplifying the script or increasing the timeout.",
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
    };

    if (process.send) {
      process.send(errorResult, () => {
        process.exit(1);
      });
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    } else {
      process.exit(1);
    }
  }, config.timeout + safetyMarginMs);

  if (globalSafetyTimer.unref) {
    globalSafetyTimer.unref();
  }

  runExecution(config)
    .then((result: WorkerResult) => {
      clearTimeout(globalSafetyTimer);
      // In legacy mode, close browser before exit since we won't reuse it
      const cleanup: Promise<void> = (async (): Promise<void> => {
        if (currentBrowser) {
          try {
            if (currentBrowser.isConnected()) {
              await currentBrowser.close();
            }
          } catch {
            // ignore
          }
          currentBrowser = null;
        }
      })();

      cleanup
        .then(() => {
          if (process.send) {
            const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(
              () => {
                process.exit(0);
              },
              IPC_FLUSH_TIMEOUT_MS,
            );

            process.send(result, () => {
              clearTimeout(fallbackTimer);
              process.exit(0);
            });
          } else {
            process.exit(0);
          }
        })
        .catch(() => {
          process.exit(1);
        });
    })
    .catch((err: unknown) => {
      clearTimeout(globalSafetyTimer);

      const errorResult: WorkerResult = {
        logMessages: [],
        scriptError: (err as Error)?.message || String(err),
        result: undefined,
        screenshots: {},
        executionTimeInMS: 0,
      };

      if (process.send) {
        const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
          process.exit(1);
        }, IPC_FLUSH_TIMEOUT_MS);

        process.send(errorResult, () => {
          clearTimeout(fallbackTimer);
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    });
}

// Entry point: receive messages via IPC
process.on(
  "message",
  (msg: ExecuteMessage | ShutdownMessage | WorkerConfig) => {
    // Distinguish new protocol (has `type` field) from legacy (plain WorkerConfig)
    if ("type" in msg && typeof msg.type === "string") {
      if (msg.type === "execute") {
        const executeMsg: ExecuteMessage = msg as ExecuteMessage;

        /*
         * Per-execution safety timer: if runExecution hangs (browser stuck, VM stuck),
         * send an error back before the pool's timeout SIGKILL-s us with no message.
         */
        const safetyMarginMs: number = 15000;
        const executionSafetyTimer: ReturnType<typeof setTimeout> = setTimeout(
          () => {
            sendMessage({
              type: "error",
              id: executeMsg.id,
              error:
                "Synthetic monitor worker safety timeout reached. " +
                "The script or browser cleanup took too long.",
            });
            /*
             * Exit so the pool doesn't reuse this worker while runExecution
             * is still in progress (would cause two concurrent executions
             * sharing the same browser).
             */
            setTimeout(() => {
              process.exit(1);
            }, 5000); // give IPC 5s to flush the error message
          },
          executeMsg.config.timeout + safetyMarginMs,
        );

        if (executionSafetyTimer.unref) {
          executionSafetyTimer.unref();
        }

        runExecution(executeMsg.config)
          .then((result: WorkerResult) => {
            clearTimeout(executionSafetyTimer);
            sendMessage({
              type: "result",
              id: executeMsg.id,
              data: result,
            });
          })
          .catch((err: unknown) => {
            clearTimeout(executionSafetyTimer);
            sendMessage({
              type: "error",
              id: executeMsg.id,
              error: (err as Error)?.message || String(err),
            });
          });
        return;
      }

      if (msg.type === "shutdown") {
        shutdownGracefully().catch(() => {
          process.exit(1);
        });
        return;
      }
    }

    // Legacy protocol: plain WorkerConfig
    handleLegacyMessage(msg as WorkerConfig);
  },
);
