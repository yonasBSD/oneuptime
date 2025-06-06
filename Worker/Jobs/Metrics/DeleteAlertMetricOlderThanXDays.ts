import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import MetricService from "Common/Server/Services/MetricService";
import { ServiceType } from "Common/Models/AnalyticsModels/Metric";
import LessThan from "Common/Types/BaseDatabase/LessThan";

RunCron(
  "Metric:DeleteAlertMetricsOlderThanXDays",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    const olderThanDays: number = 180; // store for 6 months.

    logger.debug("Checking Metric:DeleteAlertMetricsOlderThanXDays");

    logger.debug(`Deleting Alert Metrics older than ${olderThanDays} days`);

    await MetricService.deleteBy({
      query: {
        createdAt: new LessThan(OneUptimeDate.getSomeDaysAgo(olderThanDays)),
        serviceType: ServiceType.Alert,
      },
      props: {
        isRoot: true,
      },
    });
  },
);
