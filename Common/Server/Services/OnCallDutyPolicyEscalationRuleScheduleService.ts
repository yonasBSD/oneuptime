import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import { SMSMessage } from "../../Types/SMS/SMS";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import DeleteBy from "../Types/Database/DeleteBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createdItemId: ObjectID = createdItem.id!;

    if (!createdItemId) {
      throw new BadDataException("Created item does not have an ID");
    }

    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        onCallDutyPolicyScheduleId: true,
        onCallDutyPolicySchedule: {
          name: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!createdModel) {
      throw new BadDataException("Created item does not have an ID");
    }

    if (!createdModel.onCallDutyPolicyScheduleId) {
      throw new BadDataException(
        "Created item does not have a onCallDutyPolicyScheduleId",
      );
    }

    // send notification to the new current user.

    const userOnSchedule: ObjectID | null =
      await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
        createdModel.onCallDutyPolicyScheduleId,
      );

    if (!userOnSchedule) {
      return createdItem;
    }

    const scheduleName: string =
      createdModel.onCallDutyPolicySchedule?.name || "No name provided";

    const sendEmailToUserId: ObjectID | undefined | null = userOnSchedule;

    if (!sendEmailToUserId) {
      return createdItem;
    }

    if (!createdModel) {
      return createdItem;
    }

    const vars: Dictionary<string> = {
      onCallPolicyName:
        createdModel.onCallDutyPolicy?.name || "No name provided",
      escalationRuleName:
        createdModel.onCallDutyPolicyEscalationRule?.name || "No name provided",
      escalationRuleOrder:
        createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
        "No order provided",
      reason: "You are currently on roster for schedule " + scheduleName,
      onCallPolicyViewLink: (
        await OnCallDutyPolicyService.getOnCallPolicyLinkInDashboard(
          createdModel!.projectId!,
          createdModel.onCallDutyPolicy!.id!,
        )
      ).toString(),
    };

    // Notify the current user about being added to the schedule.
    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      vars: vars,
      subject: `You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName}`,
    };

    const sms: SMSMessage = {
      message: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification, go to User Settings in the OneUptime Dashboard.`,
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification, go to User Settings in the OneUptime Dashboard. Goodbye.`,
        },
      ],
    };

    await UserNotificationSettingService.sendUserNotification({
      userId: sendEmailToUserId,
      projectId: createdModel!.projectId!,
      emailEnvelope: emailMessage,
      smsMessage: sms,
      callRequestMessage: callMessage,
      eventType:
        NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    });

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToFetchBeforeDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        projectId: true,
        onCallDutyPolicyScheduleId: true,
        onCallDutyPolicySchedule: {
          name: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    return {
      deleteBy,
      carryForward: {
        deletedItems: itemsToFetchBeforeDelete,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedItems: Array<Model> = onDelete.carryForward.deletedItems;

    for (const deletedItem of deletedItems) {
      const userOnSchedule: ObjectID | null =
        await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
          deletedItem.onCallDutyPolicyScheduleId!,
        );

      if (!userOnSchedule) {
        continue;
      }

      const sendEmailToUserId: ObjectID | undefined | null = userOnSchedule;

      if (!sendEmailToUserId) {
        return onDelete;
      }

      const scheduleName: string =
        deletedItem.onCallDutyPolicySchedule?.name || "No name provided";

      const vars: Dictionary<string> = {
        onCallPolicyName:
          deletedItem.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          deletedItem.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason: `You have been removed from the on-call duty policy escalation rule for schedule ${scheduleName}.`,
        onCallPolicyViewLink: (
          await OnCallDutyPolicyService.getOnCallPolicyLinkInDashboard(
            deletedItem!.projectId!,
            deletedItem.onCallDutyPolicy!.id!,
          )
        ).toString(),
      };

      // Notify the current user about being removed from the schedule.
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
        vars: vars,
        subject: `You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      await UserNotificationSettingService.sendUserNotification({
        userId: sendEmailToUserId,
        projectId: deletedItem!.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        eventType:
          NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
      });
    }

    return onDelete;
  }
}

export default new Service();
