import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";

export default class AddMonitoringDatesToMonitor extends DataMigrationBase {
  public constructor() {
    super("AddMonitoringDatesToMonitor");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    let probeMonitors: Array<MonitorProbe> = await MonitorProbeService.findBy({
      query: {
        nextPingAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const probeMonitor of probeMonitors) {
      await MonitorProbeService.updateOneById({
        id: probeMonitor.id!,
        data: {
          nextPingAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }

    probeMonitors = await MonitorProbeService.findBy({
      query: {
        lastPingAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const probeMonitor of probeMonitors) {
      await MonitorProbeService.updateOneById({
        id: probeMonitor.id!,
        data: {
          lastPingAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
