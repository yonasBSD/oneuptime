import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/MonitorStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.priority) {
      throw new BadDataException("Monitor Status priority is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Monitor Status projectId is required");
    }

    await this.rearrangePriority(
      createBy.data.priority,
      createBy.data.projectId,
      true,
    );

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting Monitor Status. Please try the delete with objectId",
      );
    }

    let monitorStatus: Model | null = null;

    if (!deleteBy.props.isRoot) {
      monitorStatus = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          priority: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: monitorStatus,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const monitorStatus: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && monitorStatus) {
      if (monitorStatus && monitorStatus.priority && monitorStatus.projectId) {
        await this.rearrangePriority(
          monitorStatus.priority,
          monitorStatus.projectId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.priority && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Monitor Status priority should not be updated. Delete this monitor status and create a new state with the right priority.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangePriority(
    currentPriority: number,
    projectId: ObjectID,
    increasePriority: boolean = true,
  ): Promise<void> {
    // get monitor status with this priority.
    const monitorStatuses: Array<Model> = await this.findBy({
      query: {
        priority: QueryHelper.greaterThanEqualTo(currentPriority),
        projectId: projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        priority: true,
      },
      sort: {
        priority: SortOrder.Ascending,
      },
    });

    let newPriority: number = currentPriority;

    for (const monitorStatus of monitorStatuses) {
      if (increasePriority) {
        newPriority = monitorStatus.priority! + 1;
      } else {
        newPriority = monitorStatus.priority! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: monitorStatus._id!,
        },
        data: {
          priority: newPriority,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
