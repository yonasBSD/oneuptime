import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorStatus: MonitorStatus;
}

const TeamElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <span>{props.monitorStatus.name}</span>;
};

export default TeamElement;
