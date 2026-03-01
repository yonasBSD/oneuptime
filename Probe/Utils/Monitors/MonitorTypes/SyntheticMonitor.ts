import { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import SyntheticMonitorSemaphore from "../../SyntheticMonitorSemaphore";
import SyntheticMonitorWorkerPool from "../../SyntheticMonitorWorkerPool";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

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

export default class SyntheticMonitor {
  public static async execute(
    options: SyntheticMonitorOptions,
  ): Promise<Array<SyntheticMonitorResponse> | null> {
    const results: Array<SyntheticMonitorResponse> = [];
    let totalExecutions: number = 0;

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        totalExecutions++;

        logger.debug(
          `Running Synthetic Monitor: ${options?.monitorId?.toString()}, Screen Size: ${screenSizeType}, Browser: ${browserType}`,
        );

        const result: SyntheticMonitorResponse | null =
          await this.executeWithRetry({
            script: options.script,
            browserType: browserType,
            screenSizeType: screenSizeType,
            retryCountOnError: options.retryCountOnError || 0,
            monitorId: options.monitorId,
          });

        if (result) {
          result.browserType = browserType;
          result.screenSizeType = screenSizeType;
          results.push(result);
        }
      }
    }

    /*
     * If we attempted executions but got zero results (all were skipped due to
     * infrastructure errors like worker timeouts, OOM kills, or semaphore
     * issues), return null to skip this entire check cycle. This prevents the
     * monitor from flapping to the default status when the probe infrastructure
     * is under load but the monitored service may be perfectly healthy.
     */
    if (totalExecutions > 0 && results.length === 0) {
      logger.warn(
        `Synthetic Monitor ${options?.monitorId?.toString()}: all ${totalExecutions} executions were skipped due to infrastructure issues, skipping this check cycle`,
      );
      return null;
    }

    return results;
  }

  private static async executeWithRetry(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    retryCountOnError: number;
    currentRetry?: number;
    monitorId?: ObjectID | undefined;
  }): Promise<SyntheticMonitorResponse | null> {
    const maxRetries: number = options.retryCountOnError;
    const monitorIdStr: string | undefined =
      options.monitorId?.toString() || undefined;

    // Acquire semaphore once for all retries so retries reuse the same slot
    let acquired: boolean = false;

    try {
      acquired = await SyntheticMonitorSemaphore.acquire(monitorIdStr);
    } catch (err: unknown) {
      /*
       * Semaphore errors (queue full, timeout waiting for slot) are infrastructure
       * issues, not script failures. Skip this check cycle so the monitor stays in
       * its last known state instead of flapping to offline.
       */
      logger.error(
        `Synthetic monitor semaphore acquire failed (skipping this cycle): ${(err as Error)?.message}`,
      );
      return null;
    }

    if (!acquired) {
      // This monitor is already running or queued — skip duplicate execution
      return null;
    }

    try {
      return await this.executeWithRetryInner({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        retryCountOnError: maxRetries,
        currentRetry: options.currentRetry || 0,
      });
    } finally {
      SyntheticMonitorSemaphore.release(monitorIdStr);
    }
  }

  private static async executeWithRetryInner(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    retryCountOnError: number;
    currentRetry: number;
  }): Promise<SyntheticMonitorResponse | null> {
    const currentRetry: number = options.currentRetry;
    const maxRetries: number = options.retryCountOnError;

    const result: SyntheticMonitorResponse | null =
      await this.executeByBrowserAndScreenSize({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

    // If there's an error and we haven't exceeded retry count, retry
    if (result?.scriptError && currentRetry < maxRetries) {
      logger.debug(
        `Synthetic Monitor script error, retrying (${currentRetry + 1}/${maxRetries}): ${result.scriptError}`,
      );

      // Wait a bit before retrying
      await new Promise((resolve: (value: void) => void) => {
        setTimeout(resolve, 1000);
      });

      return this.executeWithRetryInner({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        retryCountOnError: maxRetries,
        currentRetry: currentRetry + 1,
      });
    }

    return result;
  }

  private static getProxyConfig(): WorkerConfig["proxy"] | undefined {
    if (!ProxyConfig.isProxyConfigured()) {
      return undefined;
    }

    const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
    const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();
    const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

    if (!proxyUrl) {
      return undefined;
    }

    const proxyConfig: WorkerConfig["proxy"] = {
      server: proxyUrl,
    };

    try {
      const parsedUrl: globalThis.URL = new URL(proxyUrl);
      if (parsedUrl.username && parsedUrl.password) {
        proxyConfig.username = parsedUrl.username;
        proxyConfig.password = parsedUrl.password;
      }
    } catch (error) {
      logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
    }

    return proxyConfig;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    if (!options) {
      options = {
        script: "",
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      };
    }

    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    const timeout: number = PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS;

    const workerConfig: WorkerConfig = {
      script: options.script,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
      timeout: timeout,
      proxy: this.getProxyConfig(),
    };

    try {
      const workerResult: WorkerResult =
        await SyntheticMonitorWorkerPool.execute(workerConfig, timeout);

      scriptResult.logMessages = workerResult.logMessages;
      scriptResult.scriptError = workerResult.scriptError;
      scriptResult.result = workerResult.result as typeof scriptResult.result;
      scriptResult.screenshots = workerResult.screenshots;
      scriptResult.executionTimeInMS = workerResult.executionTimeInMS;
    } catch (err: unknown) {
      /*
       * Errors thrown by the worker pool are always infrastructure issues (worker
       * timeout, OOM kill, process crash, IPC failure) — NOT script failures.
       * Actual script errors are returned inside WorkerResult.scriptError without
       * throwing. Skip this check cycle so the monitor stays in its last known
       * state instead of flapping between online and offline.
       */
      logger.error(
        `Synthetic monitor infrastructure error (skipping this cycle): ${(err as Error)?.message || String(err)}`,
      );
      return null;
    }

    return scriptResult;
  }
}
