import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor;
  onChange: (monitorStepMetricMonitor: MonitorStepMetricMonitor) => void;
}

const MetricMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStepMetricMonitor, setMonitorStepMetricMonitor] =
    React.useState<MonitorStepMetricMonitor>(
      props.monitorStepMetricMonitor ||
        MonitorStepMetricMonitorUtil.getDefault(),
    );

  useEffect(() => {
    props.onChange(monitorStepMetricMonitor);
  }, [monitorStepMetricMonitor]);

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      monitorStepMetricMonitor.rollingTime || RollingTime.Past1Minute,
    );

  return (
    <div>
      <RollingTimePicker
        value={monitorStepMetricMonitor.rollingTime}
        onChange={(value: RollingTime) => {
          setMonitorStepMetricMonitor({
            ...monitorStepMetricMonitor,
            rollingTime: value,
          });
        }}
      />

      <MetricView
        data={{
          startAndEndDate: startAndEndDate,
          queryConfigs: monitorStepMetricMonitor.metricViewConfig.queryConfigs,
          formulaConfigs:
            monitorStepMetricMonitor.metricViewConfig.formulaConfigs,
        }}
      />
    </div>
  );
};

export default MetricMonitorStepForm;
