import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CalendarEvent from "../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import LayerUtil, { LayerProps } from "../../Types/OnCallDutyPolicy/Layer";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import Dictionary from "../../Types/Dictionary";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { SMSMessage } from "../../Types/SMS/SMS";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import BadDataException from "../../Types/Exception/BadDataException";
import Timezone from "../../Types/Timezone";

export class Service extends DatabaseService<OnCallDutyPolicySchedule> {
  public constructor() {
    super(OnCallDutyPolicySchedule);
  }

  public async getOnCallSchedulesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<OnCallDutyPolicySchedule>> {
    const schedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: {
        projectId: data.projectId,
        currentUserIdOnRoster: data.userId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return schedules;
  }

  private async sendNotificationToUserOnScheduleHandoff(data: {
    scheduleId: ObjectID;
    previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
    newInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
  }): Promise<void> {
    // Before we send any notification, we need to check if this schedule is attached to any on-call policy.

    const escalationRulesAttachedToSchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: data.scheduleId,
        },
        select: {
          projectId: true,
          _id: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicySchedule: {
            name: true,
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (escalationRulesAttachedToSchedule.length === 0) {
      // do nothing.
      return;
    }

    for (const escalationRule of escalationRulesAttachedToSchedule) {
      const projectId: ObjectID = escalationRule.projectId!;

      const onCallSchedule: OnCallDutyPolicySchedule | undefined =
        escalationRule.onCallDutyPolicySchedule;

      if (!onCallSchedule) {
        continue;
      }

      const onCallPolicy: OnCallDutyPolicy | undefined =
        escalationRule.onCallDutyPolicy;

      if (!onCallPolicy) {
        continue;
      }

      const onCallDutyPolicyEscalationRule:
        | OnCallDutyPolicyEscalationRule
        | undefined = escalationRule.onCallDutyPolicyEscalationRule;

      if (!onCallDutyPolicyEscalationRule) {
        continue;
      }

      const { previousInformation, newInformation } = data;

      // if there's a change, witht he current user, send notification to the new current user.
      // Send notificiation to the new current user.
      if (
        previousInformation.currentUserIdOnRoster?.toString() !==
          newInformation.currentUserIdOnRoster?.toString() ||
        previousInformation.rosterHandoffAt?.toString() !==
          newInformation.rosterHandoffAt?.toString()
      ) {
        if (
          previousInformation.currentUserIdOnRoster?.toString() !==
            newInformation.currentUserIdOnRoster?.toString() &&
          previousInformation.currentUserIdOnRoster?.toString()
        ) {
          // the user has changed. Send notifiction to old user that he has been removed.

          // send notification to the new current user.

          const sendEmailToUserId: ObjectID =
            previousInformation.currentUserIdOnRoster;

          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "Your on-call roster on schedule " +
              onCallSchedule.name +
              " just ended.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: previousInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: OneUptimeDate.isInTheFuture(
                  previousInformation.rosterHandoffAt!,
                )
                  ? OneUptimeDate.getCurrentDate()
                  : previousInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          // current user changed, send alert the new current user.
          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
            vars: vars,
            subject: "You are no longer on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
          });
        }

        if (newInformation.currentUserIdOnRoster?.toString()) {
          // send email to the new current user.
          const sendEmailToUserId: ObjectID =
            newInformation.currentUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are now on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name,
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserCurrentlyOnOnCallRoster,
            vars: vars,
            subject: "You are now on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
          });
        }
      }

      // send an email to the next user.
      if (
        previousInformation.nextUserIdOnRoster?.toString() !==
          newInformation.nextUserIdOnRoster?.toString() ||
        previousInformation.nextHandOffTimeAt?.toString() !==
          newInformation.nextHandOffTimeAt?.toString() ||
        previousInformation.nextRosterStartAt?.toString() !==
          newInformation.nextRosterStartAt?.toString()
      ) {
        if (newInformation.nextUserIdOnRoster?.toString()) {
          // send email to the next user.
          const sendEmailToUserId: ObjectID = newInformation.nextUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are next on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name +
              " will start when the next handoff happens.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextRosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextHandOffTimeAt!,
                timezones: userTimezone ? [userTimezone] : [],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNextOnOnCallRoster,
            vars: vars,
            subject: "You are next on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
          });
        }
      }
    }
  }

  public async refreshCurrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    rosterStartAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    // get previoius result.
    const onCallSchedule: OnCallDutyPolicySchedule | null =
      await this.findOneById({
        id: scheduleId,
        select: {
          currentUserIdOnRoster: true,
          rosterHandoffAt: true,
          nextUserIdOnRoster: true,
          rosterNextHandoffAt: true,
          rosterStartAt: true,
          rosterNextStartAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!onCallSchedule) {
      throw new BadDataException("Schedule not found");
    }

    const previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserIdOnRoster: onCallSchedule.currentUserIdOnRoster || null,
      rosterHandoffAt: onCallSchedule.rosterHandoffAt || null,
      nextUserIdOnRoster: onCallSchedule.nextUserIdOnRoster || null,
      nextHandOffTimeAt: onCallSchedule.rosterNextHandoffAt || null,
      rosterStartAt: onCallSchedule.rosterStartAt || null,
      nextRosterStartAt: onCallSchedule.rosterNextStartAt || null,
    };

    const newInformation: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId);

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        rosterNextHandoffAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        rosterNextStartAt: newInformation.nextRosterStartAt,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    // send notification to the users.
    await this.sendNotificationToUserOnScheduleHandoff({
      scheduleId: scheduleId,
      previousInformation: previousInformation,
      newInformation: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        nextHandOffTimeAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        nextRosterStartAt: newInformation.nextRosterStartAt,
      },
    });

    return newInformation;
  }

  public async getCurrrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    rosterStartAt: Date | null;
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    const resultReturn: {
      rosterStartAt: Date | null;
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
      rosterStartAt: null,
      nextRosterStartAt: null,
    };

    const events: Array<CalendarEvent> | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        getNumberOfEvents: 2,
      });

    let currentEvent: CalendarEvent | null = events[0] || null;
    let nextEvent: CalendarEvent | null = events[1] || null;

    // if the current event start time in the future then the current event is the next event.
    if (currentEvent && OneUptimeDate.isInTheFuture(currentEvent.start)) {
      nextEvent = currentEvent;
      currentEvent = null;
    }

    if (currentEvent) {
      const userId: string | undefined = currentEvent?.title; // this is user id in string.

      if (userId) {
        resultReturn.currentUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = currentEvent?.end; // this is user id in string.
      if (handOffTime) {
        resultReturn.handOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = currentEvent?.start; // this is user id in string.
      if (startTime) {
        resultReturn.rosterStartAt = startTime;
      }
    }

    // do the same for next event.

    if (nextEvent) {
      const userId: string | undefined = nextEvent?.title; // this is user id in string.

      if (userId) {
        resultReturn.nextUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = nextEvent?.end; // this is user id in string.
      if (handOffTime) {
        resultReturn.nextHandOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = nextEvent?.start; // this is user id in string.
      if (startTime) {
        resultReturn.nextRosterStartAt = startTime;
      }
    }

    return resultReturn;
  }

  private async getScheduleLayerProps(data: {
    scheduleId: ObjectID;
  }): Promise<Array<LayerProps>> {
    // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;

    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      await OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          order: true,
          name: true,
          description: true,
          startsAt: true,
          restrictionTimes: true,
          rotation: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          handOffTime: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          user: true,
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const layerProps: Array<LayerProps> = [];

    for (const layer of layers) {
      layerProps.push({
        users:
          layerUsers
            .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return (
                layerUser.onCallDutyPolicyScheduleLayerId?.toString() ===
                layer.id?.toString()
              );
            })
            .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return layerUser.user!;
            })
            .filter((user: User) => {
              return Boolean(user);
            }) || [],
        startDateTimeOfLayer: layer.startsAt!,
        restrictionTimes: layer.restrictionTimes!,
        rotation: layer.rotation!,
        handOffTime: layer.handOffTime!,
      });
    }

    return layerProps;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    getNumberOfEvents: number; // which event would you like to get. First event, second event, etc.
  }): Promise<Array<CalendarEvent>> {
    const layerProps: Array<LayerProps> = await this.getScheduleLayerProps({
      scheduleId: data.scheduleId,
    });

    if (layerProps.length === 0) {
      return [];
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveYears(
      currentStartTime,
      1,
    );

    const numberOfEventsToGet: number = data.getNumberOfEvents;
    const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: numberOfEventsToGet,
      },
    );

    return events;
  }

  @CaptureSpan()
  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
  ): Promise<ObjectID | null> {
    const layerProps: Array<LayerProps> = await this.getScheduleLayerProps({
      scheduleId: scheduleId,
    });

    if (layerProps.length === 0) {
      return null;
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveSeconds(
      currentStartTime,
      1,
    );

    const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: 1,
      },
    );

    const currentEvent: CalendarEvent | null = events[0] || null;

    if (!currentEvent) {
      return null;
    }

    const userId: string | undefined = currentEvent?.title; // this is user id in string.

    if (!userId) {
      return null;
    }

    return new ObjectID(userId);
  }
}

export default new Service();
