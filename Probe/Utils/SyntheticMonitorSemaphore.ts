import os from "os";
import logger from "Common/Server/Utils/Logger";

interface Waiter {
  resolve: (value: boolean) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  monitorId?: string | undefined;
}

const MEMORY_BUFFER_BYTES: number = 256 * 1024 * 1024; // 256 MB reserved for probe + OS
const MEMORY_PER_MONITOR_BYTES: number = 250 * 1024 * 1024; // ~250 MB per fork (Node + Playwright)
const ACQUIRE_TIMEOUT_MS: number = 5 * 60 * 1000; // 5 minutes
const MAX_QUEUE_DEPTH: number = 20; // max waiters in queue before rejecting

class SyntheticMonitorSemaphore {
  private running: number = 0;
  private queue: Waiter[] = [];
  // Track monitorIds that are currently running or queued to prevent duplicates
  private activeMonitorIds: Set<string> = new Set();

  private calculateMaxSlots(): number {
    const free: number = os.freemem();
    const usable: number = free - MEMORY_BUFFER_BYTES;
    const slots: number = Math.floor(usable / MEMORY_PER_MONITOR_BYTES);
    return Math.max(2, slots); // always allow at least 2 concurrent monitors, even if memory is low, to avoid complete service disruption (with the risk of OOM)
  }

  /**
   * @returns true if the slot was acquired, false if this monitorId is already running/queued (duplicate skipped).
   */
  public async acquire(monitorId?: string | undefined): Promise<boolean> {
    // Deduplicate: if this monitor is already running or queued, skip it
    if (monitorId && this.activeMonitorIds.has(monitorId)) {
      logger.debug(
        `SyntheticMonitorSemaphore: monitor ${monitorId} is already running or queued, skipping duplicate`,
      );
      return false;
    }

    if (monitorId) {
      this.activeMonitorIds.add(monitorId);
    }

    const maxSlots: number = this.calculateMaxSlots();

    if (this.running < maxSlots) {
      this.running++;
      logger.debug(
        `SyntheticMonitorSemaphore: acquired slot (${this.running}/${maxSlots} active, ${this.queue.length} queued, freemem=${Math.round(os.freemem() / 1024 / 1024)}MB)`,
      );
      return true;
    }

    // Reject fast if the queue is already full — avoids a guaranteed 5-minute timeout
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      if (monitorId) {
        this.activeMonitorIds.delete(monitorId);
      }
      throw new Error(
        `SyntheticMonitorSemaphore: queue is full (${MAX_QUEUE_DEPTH} waiters). ` +
          `Try again later or reduce synthetic monitor concurrency.`,
      );
    }

    logger.debug(
      `SyntheticMonitorSemaphore: all ${maxSlots} slots in use (${this.queue.length} already queued), waiting...`,
    );

    return new Promise<boolean>(
      (resolve: (value: boolean) => void, reject: (reason: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          const index: number = this.queue.indexOf(waiter);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          if (monitorId) {
            this.activeMonitorIds.delete(monitorId);
          }
          reject(
            new Error(
              "SyntheticMonitorSemaphore: timed out waiting for a slot",
            ),
          );
        }, ACQUIRE_TIMEOUT_MS);

        const waiter: Waiter = { resolve, reject, timer, monitorId };
        this.queue.push(waiter);
      },
    );
  }

  public release(monitorId?: string | undefined): void {
    this.running = Math.max(0, this.running - 1);

    if (monitorId) {
      this.activeMonitorIds.delete(monitorId);
    }

    // Re-check available memory and wake as many waiters as slots allow
    const maxSlots: number = this.calculateMaxSlots();
    let woken: number = 0;

    while (this.queue.length > 0 && this.running < maxSlots) {
      const next: Waiter = this.queue.shift()!;
      clearTimeout(next.timer);
      this.running++;
      woken++;
      next.resolve(true);
    }

    if (woken > 0) {
      logger.debug(
        `SyntheticMonitorSemaphore: woke ${woken} queued waiter(s) (${this.running}/${maxSlots} active, ${this.queue.length} still queued, freemem=${Math.round(os.freemem() / 1024 / 1024)}MB)`,
      );
    } else {
      logger.debug(
        `SyntheticMonitorSemaphore: released slot (${this.running}/${maxSlots} active, ${this.queue.length} queued, freemem=${Math.round(os.freemem() / 1024 / 1024)}MB)`,
      );
    }
  }

  public getStatus(): {
    running: number;
    queued: number;
    maxSlots: number;
  } {
    return {
      running: this.running,
      queued: this.queue.length,
      maxSlots: this.calculateMaxSlots(),
    };
  }
}

export default new SyntheticMonitorSemaphore();
