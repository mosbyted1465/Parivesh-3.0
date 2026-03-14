export const WORKFLOW_STATUSES = [
  "draft",
  "submitted",
  "under_scrutiny",
  "eds",
  "referred",
  "mom_generated",
  "finalized",
] as const;

export type ApplicationStatus = (typeof WORKFLOW_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_scrutiny", "eds"],
  under_scrutiny: ["eds", "referred"],
  eds: ["under_scrutiny"],
  referred: ["mom_generated"],
  mom_generated: ["finalized"],
  finalized: [],
};

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return WORKFLOW_STATUSES.includes(value as ApplicationStatus);
}

export function canTransition(
  currentStatus: ApplicationStatus,
  nextStatus: ApplicationStatus
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}
