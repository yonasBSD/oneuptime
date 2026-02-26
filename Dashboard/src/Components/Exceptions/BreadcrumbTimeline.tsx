import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  Green500,
  Red500,
  Yellow500,
  Blue500,
  Purple500,
  Gray500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";

export interface BreadcrumbEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export enum BreadcrumbCategory {
  HTTP = "HTTP",
  DB = "DB",
  Log = "LOG",
  Error = "ERROR",
  Warning = "WARN",
  Event = "EVENT",
  Exception = "EXCEPTION",
}

export interface ComponentProps {
  events: BreadcrumbEvent[];
  exceptionTime?: Date; // time of the exception, for relative timestamps
  maxEvents?: number; // limit number of events to display (default: 30)
}

const BreadcrumbTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const maxEvents: number = props.maxEvents || 30;

  // Sort events by time ascending
  const sortedEvents: BreadcrumbEvent[] = [...props.events]
    .sort((a: BreadcrumbEvent, b: BreadcrumbEvent) => {
      return a.timeUnixNano - b.timeUnixNano;
    })
    .slice(-maxEvents);

  if (sortedEvents.length === 0) {
    return (
      <Card
        title="Breadcrumbs"
        description="Events leading up to the exception."
      >
        <div className="px-4 py-8 text-center text-gray-500 text-sm">
          No breadcrumb events available for this exception.
        </div>
      </Card>
    );
  }

  type CategorizeEventFunction = (event: BreadcrumbEvent) => BreadcrumbCategory;

  const categorizeEvent: CategorizeEventFunction = (
    event: BreadcrumbEvent,
  ): BreadcrumbCategory => {
    const name: string = (event.name || "").toLowerCase();
    const attrs: JSONObject = event.attributes || {};

    // Check for exception type
    if (name === "exception" || attrs["exception.type"]) {
      return BreadcrumbCategory.Exception;
    }

    // Check for HTTP events
    if (
      name.includes("http") ||
      attrs["http.method"] ||
      attrs["http.status_code"] ||
      attrs["http.url"]
    ) {
      return BreadcrumbCategory.HTTP;
    }

    // Check for DB events
    if (
      name.includes("db") ||
      name.includes("database") ||
      name.includes("query") ||
      name.includes("sql") ||
      attrs["db.system"] ||
      attrs["db.statement"]
    ) {
      return BreadcrumbCategory.DB;
    }

    // Check for log/console events
    if (name.includes("log") || name.includes("console")) {
      return BreadcrumbCategory.Log;
    }

    // Check for error/warning in attributes
    if (
      name.includes("error") ||
      attrs["level"] === "error" ||
      attrs["severity"] === "error"
    ) {
      return BreadcrumbCategory.Error;
    }

    if (
      name.includes("warn") ||
      attrs["level"] === "warn" ||
      attrs["level"] === "warning" ||
      attrs["severity"] === "warning"
    ) {
      return BreadcrumbCategory.Warning;
    }

    return BreadcrumbCategory.Event;
  };

  type GetCategoryColorFunction = (category: BreadcrumbCategory) => Color;

  const getCategoryColor: GetCategoryColorFunction = (
    category: BreadcrumbCategory,
  ): Color => {
    switch (category) {
      case BreadcrumbCategory.HTTP:
        return Blue500;
      case BreadcrumbCategory.DB:
        return Purple500;
      case BreadcrumbCategory.Log:
        return Gray500;
      case BreadcrumbCategory.Error:
        return Red500;
      case BreadcrumbCategory.Warning:
        return Yellow500;
      case BreadcrumbCategory.Exception:
        return Red500;
      case BreadcrumbCategory.Event:
        return Green500;
      default:
        return Gray500;
    }
  };

  type GetCategoryIconFunction = (category: BreadcrumbCategory) => IconProp;

  const getCategoryIcon: GetCategoryIconFunction = (
    category: BreadcrumbCategory,
  ): IconProp => {
    switch (category) {
      case BreadcrumbCategory.HTTP:
        return IconProp.Globe;
      case BreadcrumbCategory.DB:
        return IconProp.Database;
      case BreadcrumbCategory.Log:
        return IconProp.Terminal;
      case BreadcrumbCategory.Error:
        return IconProp.Alert;
      case BreadcrumbCategory.Warning:
        return IconProp.Alert;
      case BreadcrumbCategory.Exception:
        return IconProp.Error;
      case BreadcrumbCategory.Event:
        return IconProp.Info;
      default:
        return IconProp.Info;
    }
  };

  type FormatRelativeTimeFunction = (eventTime: Date) => string;

  const formatRelativeTime: FormatRelativeTimeFunction = (
    eventTime: Date,
  ): string => {
    if (!props.exceptionTime) {
      return OneUptimeDate.getDateAsLocalFormattedString(eventTime);
    }

    const diffMs: number =
      eventTime.getTime() - props.exceptionTime.getTime();
    const absDiffMs: number = Math.abs(diffMs);

    if (absDiffMs < 1000) {
      return diffMs <= 0 ? "0s" : `+${absDiffMs}ms`;
    }

    const seconds: number = Math.floor(absDiffMs / 1000);
    if (seconds < 60) {
      return diffMs <= 0 ? `-${seconds}s` : `+${seconds}s`;
    }

    const minutes: number = Math.floor(seconds / 60);
    const remainingSeconds: number = seconds % 60;
    const prefix: string = diffMs <= 0 ? "-" : "+";
    return `${prefix}${minutes}m ${remainingSeconds}s`;
  };

  type GetEventSummaryFunction = (event: BreadcrumbEvent) => string;

  const getEventSummary: GetEventSummaryFunction = (
    event: BreadcrumbEvent,
  ): string => {
    const attrs: JSONObject = event.attributes || {};

    // HTTP events
    if (attrs["http.method"] || attrs["http.url"]) {
      const method: string = (attrs["http.method"] as string) || "";
      const url: string = (attrs["http.url"] as string) || "";
      const status: string = attrs["http.status_code"]
        ? ` ${attrs["http.status_code"]}`
        : "";
      return `${method} ${url}${status}`;
    }

    // DB events
    if (attrs["db.statement"]) {
      const statement: string = (attrs["db.statement"] as string) || "";
      return statement.length > 80
        ? statement.substring(0, 80) + "..."
        : statement;
    }

    // Exception events
    if (attrs["exception.message"]) {
      const msg: string = (attrs["exception.message"] as string) || "";
      return msg.length > 80 ? msg.substring(0, 80) + "..." : msg;
    }

    // Generic events - use the event name
    return event.name || "Event";
  };

  type GetEventDetailFunction = (event: BreadcrumbEvent) => string | null;

  const getEventDetail: GetEventDetailFunction = (
    event: BreadcrumbEvent,
  ): string | null => {
    const attrs: JSONObject = event.attributes || {};

    if (attrs["http.status_code"]) {
      const code: number = attrs["http.status_code"] as number;
      if (code >= 400) {
        return `Status: ${code}`;
      }
    }

    if (attrs["exception.type"]) {
      return attrs["exception.type"] as string;
    }

    return null;
  };

  return (
    <Card
      title="Breadcrumbs"
      description={`${sortedEvents.length} events leading up to the exception.`}
    >
      <div className="divide-y divide-gray-100">
        {sortedEvents.map(
          (event: BreadcrumbEvent, index: number): ReactElement => {
            const category: BreadcrumbCategory = categorizeEvent(event);
            const color: Color = getCategoryColor(category);
            const icon: IconProp = getCategoryIcon(category);
            const summary: string = getEventSummary(event);
            const detail: string | null = getEventDetail(event);
            const isException: boolean =
              category === BreadcrumbCategory.Exception;

            return (
              <div
                key={index}
                className={`flex items-start px-4 py-2.5 ${
                  isException ? "bg-red-50" : "hover:bg-gray-50"
                }`}
              >
                {/* Timeline line and dot */}
                <div className="flex flex-col items-center mr-3 flex-shrink-0">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      isException ? "bg-red-100" : "bg-gray-100"
                    }`}
                  >
                    <Icon
                      icon={icon}
                      size={SizeProp.Smaller}
                      className={
                        isException ? "text-red-600" : "text-gray-500"
                      }
                    />
                  </div>
                  {index < sortedEvents.length - 1 && (
                    <div className="w-px h-full min-h-[8px] bg-gray-200 mt-1" />
                  )}
                </div>

                {/* Category pill */}
                <div className="flex-shrink-0 w-16 mr-3 pt-0.5">
                  <Pill text={category} color={color} />
                </div>

                {/* Event summary */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-mono truncate ${
                      isException
                        ? "text-red-800 font-medium"
                        : "text-gray-800"
                    }`}
                  >
                    {summary}
                  </div>
                  {detail && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {detail}
                    </div>
                  )}
                </div>

                {/* Relative timestamp */}
                <div className="flex-shrink-0 ml-3 text-xs text-gray-400 font-mono whitespace-nowrap pt-0.5">
                  {formatRelativeTime(event.time)}
                </div>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
};

export default BreadcrumbTimeline;
