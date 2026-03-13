import React from "react";

interface ApplicationTimelineProps {
  currentStatus: string;
}

const statuses = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "under_scrutiny", label: "Under Scrutiny" },
  { key: "eds", label: "EDS" },
  { key: "referred", label: "Referred" },
  { key: "mom_generated", label: "MoM Generated" },
  { key: "finalized", label: "Finalized" },
];

export default function ApplicationTimeline({ currentStatus }: ApplicationTimelineProps) {
  const currentIndex = statuses.findIndex((status) => status.key === currentStatus);

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between">
        {statuses.map((status, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <div key={status.key} className="flex flex-col items-center flex-1">
              {/* Circle */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                  isCompleted
                    ? "bg-green-500 border-green-500 text-white"
                    : isCurrent
                    ? "bg-blue-500 border-blue-500 text-white"
                    : "bg-gray-200 border-gray-300 text-gray-500"
                }`}
              >
                {isCompleted ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>

              {/* Label */}
              <div className="mt-2 text-center">
                <p
                  className={`text-sm font-medium ${
                    isCompleted
                      ? "text-green-600"
                      : isCurrent
                      ? "text-blue-600"
                      : "text-gray-500"
                  }`}
                >
                  {status.label}
                </p>
              </div>

              {/* Connector Line */}
              {index < statuses.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mt-4 ${
                    isCompleted ? "bg-green-500" : "bg-gray-300"
                  }`}
                  style={{ width: "100%", minWidth: "20px" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}