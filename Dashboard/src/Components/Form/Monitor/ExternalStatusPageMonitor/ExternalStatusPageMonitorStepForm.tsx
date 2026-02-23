import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  monitorStepExternalStatusPageMonitor: MonitorStepExternalStatusPageMonitor;
  onChange: (value: MonitorStepExternalStatusPageMonitor) => void;
}

const ExternalStatusPageMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  const providerOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(ExternalStatusPageProviderType);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Status Page URL"
          description="The URL of the external status page to monitor (e.g. https://www.githubstatus.com)"
          required={true}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.statusPageUrl
          }
          placeholder="https://status.example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              statusPageUrl: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Provider Type"
          description="How to fetch status data. Auto will try Atlassian Statuspage JSON API first, then fall back to RSS/Atom."
          required={true}
        />
        <Dropdown
          options={providerOptions}
          initialValue={providerOptions.find((option: DropdownOption) => {
            return (
              option.value ===
              props.monitorStepExternalStatusPageMonitor.provider
            );
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              provider: value as ExternalStatusPageProviderType,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Component Name Filter (Optional)"
          description="Filter to a specific component by name. Leave blank to monitor overall status."
          required={false}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.componentName || ""
          }
          placeholder="e.g. API, Compute Engine, us-east-1"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              componentName: value || undefined,
            });
          }}
        />
      </div>

      {!showAdvancedOptions && (
        <div className="mt-1 -ml-3">
          <Button
            title="Advanced: Timeout and Retries"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            onClick={() => {
              setShowAdvancedOptions(true);
            }}
          />
        </div>
      )}

      {showAdvancedOptions && (
        <div className="space-y-4 border p-4 rounded-md bg-gray-50">
          <h4 className="font-medium">Advanced Options</h4>

          <div>
            <FieldLabelElement
              title="Timeout (ms)"
              description="How long to wait for a response before timing out"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.timeout?.toString() ||
                "10000"
              }
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  timeout: parseInt(value) || 10000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Retries"
              description="Number of times to retry on failure"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.retries?.toString() ||
                "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  retries: parseInt(value) || 3,
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ExternalStatusPageMonitorStepForm;
