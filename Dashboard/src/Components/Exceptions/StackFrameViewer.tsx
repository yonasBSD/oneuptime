import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Gray500 } from "Common/Types/BrandColors";

export interface StackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
  inApp: boolean;
}

export interface ComponentProps {
  stackTrace: string;
  parsedFrames?: string; // JSON stringified StackFrame[]
}

const StackFrameViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [expandedFrameIndex, setExpandedFrameIndex] = useState<number | null>(
    null,
  );
  const [showAllFrames, setShowAllFrames] = useState<boolean>(false);

  let frames: StackFrame[] = [];

  try {
    if (props.parsedFrames) {
      frames = JSON.parse(props.parsedFrames) as StackFrame[];
    }
  } catch {
    frames = [];
  }

  // If no parsed frames available, fall back to raw stack trace display
  if (frames.length === 0) {
    return (
      <Card
        title="Stack Trace"
        description="Raw stack trace from the exception."
      >
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre-wrap">
          {props.stackTrace}
        </pre>
      </Card>
    );
  }

  const appFrames: Array<{ frame: StackFrame; originalIndex: number }> = frames
    .map((frame: StackFrame, index: number) => {
      return { frame, originalIndex: index };
    })
    .filter(({ frame }: { frame: StackFrame }) => {
      return frame.inApp;
    });

  const libraryFrames: Array<{ frame: StackFrame; originalIndex: number }> =
    frames
      .map((frame: StackFrame, index: number) => {
        return { frame, originalIndex: index };
      })
      .filter(({ frame }: { frame: StackFrame }) => {
        return !frame.inApp;
      });

  const displayFrames: Array<{ frame: StackFrame; originalIndex: number }> =
    showAllFrames
      ? frames.map((frame: StackFrame, index: number) => {
          return { frame, originalIndex: index };
        })
      : appFrames.length > 0
        ? appFrames
        : frames.map((frame: StackFrame, index: number) => {
            return { frame, originalIndex: index };
          });

  type ToggleFrameFunction = (index: number) => void;

  const toggleFrame: ToggleFrameFunction = (index: number): void => {
    setExpandedFrameIndex(expandedFrameIndex === index ? null : index);
  };

  type RenderFrameFunction = (frame: StackFrame, index: number) => ReactElement;

  const renderFrame: RenderFrameFunction = (
    frame: StackFrame,
    index: number,
  ): ReactElement => {
    const isExpanded: boolean = expandedFrameIndex === index;

    // Shorten the file path for display
    const shortFileName: string = frame.fileName
      ? frame.fileName.split("/").slice(-2).join("/")
      : "";

    const locationStr: string = frame.lineNumber
      ? `${shortFileName}:${frame.lineNumber}${frame.columnNumber ? `:${frame.columnNumber}` : ""}`
      : shortFileName;

    return (
      <div
        key={index}
        className={`border-b border-gray-200 last:border-b-0 ${isExpanded ? "bg-gray-50" : "hover:bg-gray-50"}`}
      >
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
          onClick={() => {
            toggleFrame(index);
          }}
        >
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <Icon
              icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
              size={SizeProp.Smaller}
              className="text-gray-400 flex-shrink-0"
            />
            <span className="font-mono text-sm text-gray-900 truncate">
              {frame.functionName || "<anonymous>"}
            </span>
            {locationStr && (
              <span className="font-mono text-xs text-gray-500 truncate">
                {locationStr}
              </span>
            )}
          </div>
          <div className="flex-shrink-0 ml-2">
            <Pill
              text={frame.inApp ? "APP" : "LIB"}
              color={frame.inApp ? Green500 : Gray500}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 pb-3">
            <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
              <table className="text-sm font-mono w-full">
                <tbody>
                  <tr>
                    <td className="text-gray-400 pr-4 whitespace-nowrap align-top py-1">
                      Function
                    </td>
                    <td className="text-gray-100 py-1">
                      {frame.functionName || "<anonymous>"}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-gray-400 pr-4 whitespace-nowrap align-top py-1">
                      File
                    </td>
                    <td className="text-gray-100 py-1 break-all">
                      {frame.fileName || "Unknown"}
                    </td>
                  </tr>
                  {frame.lineNumber > 0 && (
                    <tr>
                      <td className="text-gray-400 pr-4 whitespace-nowrap align-top py-1">
                        Line
                      </td>
                      <td className="text-gray-100 py-1">
                        {frame.lineNumber}
                        {frame.columnNumber
                          ? `, Column ${frame.columnNumber}`
                          : ""}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="text-gray-400 pr-4 whitespace-nowrap align-top py-1">
                      Type
                    </td>
                    <td className="text-gray-100 py-1">
                      {frame.inApp ? "Application Code" : "Library / Framework"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Stack Trace"
      description={`${frames.length} frames (${appFrames.length} app, ${libraryFrames.length} library)`}
    >
      <div>
        {/* Toggle button for showing all frames vs app frames only */}
        {appFrames.length > 0 && libraryFrames.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
            <span className="text-sm text-gray-600">
              {showAllFrames
                ? `Showing all ${frames.length} frames`
                : `Showing ${appFrames.length} app frames`}
            </span>
            <button
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              onClick={() => {
                setShowAllFrames(!showAllFrames);
              }}
            >
              {showAllFrames ? "Show App Frames Only" : "Show All Frames"}
            </button>
          </div>
        )}

        {/* Frame list */}
        <div className="divide-y divide-gray-200">
          {displayFrames.map(
            ({
              frame,
              originalIndex,
            }: {
              frame: StackFrame;
              originalIndex: number;
            }) => {
              return renderFrame(frame, originalIndex);
            },
          )}
        </div>

        {/* Raw stack trace collapsible */}
        <details className="border-t border-gray-200">
          <summary className="px-4 py-3 text-sm text-gray-500 cursor-pointer hover:text-gray-700">
            <Icon
              icon={IconProp.Code}
              size={SizeProp.Smaller}
              className="inline mr-2"
            />
            View Raw Stack Trace
          </summary>
          <pre className="bg-gray-900 text-gray-100 p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto mx-4 mb-4 rounded-lg">
            {props.stackTrace}
          </pre>
        </details>
      </div>
    </Card>
  );
};

export default StackFrameViewer;
