import PageComponentProps from "../../PageComponentProps";
import { Black } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";

const ScheduledMaintenanceDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceStateTimeline>
        modelType={ScheduledMaintenanceStateTimeline}
        id="table-scheduledMaintenance-status-timeline"
        userPreferencesKey="scheduled-maintenance-status-timeline-table"
        name="Scheduled Maintenance Events > State Timeline"
        isDeleteable={true}
        isCreateable={true}
        showViewIdButton={true}
        isViewable={false}
        query={{
          scheduledMaintenanceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceStateTimeline,
        ): Promise<ScheduledMaintenanceStateTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.scheduledMaintenanceId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description:
            "Here is the status timeline for this Scheduled Maintenance",
        }}
        noItemsMessage={
          "No status timeline created for this Scheduled Maintenance so far."
        }
        formFields={[
          {
            field: {
              scheduledMaintenanceState: true,
            },
            title: "Scheduled Maintenance Status",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Scheduled Maintenance Status",
            dropdownModal: {
              type: ScheduledMaintenanceState,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Starts At",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },

            title: "Notify Status Page Subscribers",
            description: "Should status page subscribers be notified?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
                color: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,

            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              if (!item["scheduledMaintenanceState"]) {
                throw new BadDataException(
                  "Scheduled Maintenance Status not found",
                );
              }

              return (
                <Pill
                  color={item.scheduledMaintenanceState.color || Black}
                  text={item.scheduledMaintenanceState.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
            noValueMessage: "Currently Active",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Duration",
            type: FieldType.Text,
            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              return (
                <p>
                  {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                    item["startsAt"] as Date,
                    (item["endsAt"] as Date) || OneUptimeDate.getCurrentDate(),
                  )}
                </p>
              );
            },
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceDelete;
