"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import ProtectedRoute from "../../components/ProtectedRoute";
import ApplicationTimeline from "../../components/ApplicationTimeline";
import {
  canTransition,
  isApplicationStatus,
  type ApplicationStatus,
} from "@/lib/workflow";

interface Application {
  id: string;
  projectName: string;
  location: string;
  description: string;
  status: string;
  ownerEmail?: string;
  documents?: Array<{
    key?: string;
    name?: string;
    url?: string;
    contentType?: string;
  }>;
  payment?: {
    method?: "upi" | "qr";
    reference?: string;
    status?: "verified" | "pending";
    verifiedAt?: string;
  };
  checklist?: {
    documentsVerified?: boolean;
    paymentVerified?: boolean;
    details?: string;
    lockedByScrutiny?: boolean;
    updatedAt?: string;
  };
  eds?: {
    active?: boolean;
    remarks?: string;
    requestedAt?: string;
    responseNotes?: string;
    respondedAt?: string;
    resubmissionCount?: number;
  };
}

interface ChecklistDraft {
  documentsVerified: boolean;
  paymentVerified: boolean;
  details: string;
}

interface ProcessingRunDocument {
  key?: string;
  ok?: boolean;
  error?: string;
  analysis?: {
    pageCount?: number | null;
    sizeBytes?: number;
  };
}

interface ProcessingRun {
  id: string;
  applicationId?: string;
  count?: number;
  okCount?: number;
  processedAt?: string;
  documents?: ProcessingRunDocument[];
}

export default function ScrutinyDashboard() {
  const backendBaseUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [edsRemarks, setEdsRemarks] = useState<Record<string, string>>({});
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, ChecklistDraft>>({});
  const [processingHistory, setProcessingHistory] = useState<Record<string, ProcessingRun[]>>({});

  const getBackendAuthHeaders = async () => {
    const user = auth.currentUser;
    if (!user) {
      return {} as Record<string, string>;
    }

    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  const fetchProcessingHistory = async (appIds: string[]) => {
    if (!backendBaseUrl || appIds.length === 0) {
      setProcessingHistory({});
      return;
    }

    const entries = await Promise.all(
      appIds.map(async (appId) => {
        try {
          const response = await fetch(
            `${backendBaseUrl}/api/process-documents-history?applicationId=${encodeURIComponent(appId)}`,
            {
              headers: await getBackendAuthHeaders(),
            }
          );

          if (!response.ok) {
            return [appId, [] as ProcessingRun[]] as const;
          }

          const data = (await response.json()) as ProcessingRun[];
          return [appId, data] as const;
        } catch (error) {
          console.warn("Failed to fetch processing history for", appId, error);
          return [appId, [] as ProcessingRun[]] as const;
        }
      })
    );

    setProcessingHistory(Object.fromEntries(entries));
  };

  const fetchApplications = async () => {
    try {
      const q = query(
        collection(db, "applications"),
        where("status", "in", ["submitted", "under_scrutiny", "eds"])
      );
      const querySnapshot = await getDocs(q);
      const apps: Application[] = querySnapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<Application, "id">),
      }));
      setApplications(apps);

      const nextChecklistDrafts: Record<string, ChecklistDraft> = {};
      const nextEdsRemarks: Record<string, string> = {};

      for (const app of apps) {
        nextChecklistDrafts[app.id] = {
          documentsVerified: app.checklist?.documentsVerified || false,
          paymentVerified: app.checklist?.paymentVerified || app.payment?.status === "verified",
          details: app.checklist?.details || "",
        };

        nextEdsRemarks[app.id] = app.eds?.remarks || "";
      }

      setChecklistDrafts(nextChecklistDrafts);
      setEdsRemarks(nextEdsRemarks);
      await fetchProcessingHistory(apps.map((item) => item.id));
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (app: Application, newStatus: ApplicationStatus, extra: Record<string, unknown> = {}) => {
    try {
      if (!isApplicationStatus(app.status)) {
        alert("Invalid status transition.");
        return;
      }

      if (!canTransition(app.status, newStatus)) {
        alert(`Transition not allowed: ${app.status} -> ${newStatus}`);
        return;
      }

      if ((newStatus === "under_scrutiny" || newStatus === "referred") && app.payment?.status !== "verified") {
        alert("Fee payment must be verified before moving this application.");
        return;
      }

      if (newStatus === "referred") {
        const checklist = checklistDrafts[app.id];

        if (!checklist?.documentsVerified || !checklist?.paymentVerified) {
          alert("Checklist must confirm documents and payment verification before referral.");
          return;
        }
      }

      const nextExtra = { ...extra };
      if (newStatus === "referred") {
        const checklist = checklistDrafts[app.id];
        nextExtra.checklist = {
          documentsVerified: !!checklist?.documentsVerified,
          paymentVerified: !!checklist?.paymentVerified,
          details: checklist?.details || "",
          lockedByScrutiny: true,
          updatedAt: new Date().toISOString(),
        };
      }

      const appRef = doc(db, "applications", app.id);
      await updateDoc(appRef, {
        status: newStatus,
        updatedAt: new Date().toISOString(),
        ...nextExtra,
      });

      await fetchApplications();
    } catch (error) {
      console.error("Error updating status:", error);
      const code = (error as { code?: string })?.code;
      if (code === "permission-denied") {
        alert("Status update blocked by rules. Save checklist first, then retry the transition.");
      } else {
        alert("Failed to update status. Please try again.");
      }
    }
  };

  const saveChecklist = async (app: Application) => {
    try {
      const checklist = checklistDrafts[app.id];

      if (!checklist) {
        alert("No checklist data found.");
        return;
      }

      await updateDoc(doc(db, "applications", app.id), {
        checklist: {
          ...checklist,
          lockedByScrutiny: true,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      });

      alert("Scrutiny checklist saved.");
      await fetchApplications();
    } catch (error) {
      console.error("Error saving checklist:", error);
      alert("Failed to save checklist.");
    }
  };

  const sendEDS = async (app: Application) => {
    const remarks = (edsRemarks[app.id] || "").trim();

    if (!remarks) {
      alert("Please enter EDS remarks before sending back.");
      return;
    }

    await updateStatus(app, "eds", {
      eds: {
        ...(app.eds || {}),
        active: true,
        remarks,
        requestedAt: new Date().toISOString(),
      },
    });
  };

  const acceptResubmission = async (app: Application) => {
    await updateStatus(app, "under_scrutiny", {
      eds: {
        ...(app.eds || {}),
        active: false,
      },
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setApplications([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      await fetchApplications();
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <main className="container">
        <p>Loading applications...</p>
      </main>
    );
  }

  return (
    <ProtectedRoute allowedRole="scrutiny">
      <main className="container">
        <header className="header">
          <div>
            <h1 className="title">Scrutiny Dashboard</h1>
            <p className="subtitle">Verify documents, maintain checklist, issue EDS, and refer eligible cases.</p>
            <p className="text-sm" style={{ marginTop: 8, color: "var(--muted)" }}>
              Role Scope: Verification authority only; MoM cannot edit scrutiny checklist fields.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {applications.map((app) => (
            <div key={app.id} className="card">
              <h3 className="text-lg font-semibold mb-2">{app.projectName}</h3>
              <p className="text-sm text-gray-600 mb-1"><strong>Location:</strong> {app.location}</p>
              <p className="text-sm text-gray-600 mb-1"><strong>Applicant:</strong> {app.ownerEmail || "N/A"}</p>
              <p className="text-sm text-gray-600 mb-2"><strong>Description:</strong> {app.description}</p>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 className="text-sm font-semibold" style={{ marginTop: 0 }}>Uploaded Documents</h4>
                {app.documents?.length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {app.documents.map((file, index) => (
                      <div key={`${app.id}-doc-${index}`} style={{ fontSize: "0.85rem" }}>
                        <strong>{file.key || `Document ${index + 1}`}:</strong>{" "}
                        {file.url ? (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#1d4ed8", textDecoration: "underline" }}
                          >
                            {file.name || "Open PDF"}
                          </a>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>URL not available</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ margin: 0, color: "var(--muted)" }}>
                    No document links available on this application.
                  </p>
                )}
              </div>

              <p className="text-sm text-gray-600 mb-2">
                <strong>Fee Payment:</strong>{" "}
                {app.payment?.status === "verified"
                  ? `Verified (${(app.payment?.method || "").toUpperCase()}${app.payment?.reference ? `: ${app.payment.reference}` : ""})`
                  : "Pending"}
              </p>

              <p className="text-sm mb-3">
                <strong>Status:</strong>{" "}
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    app.status === "submitted"
                      ? "bg-blue-100 text-blue-800"
                      : app.status === "under_scrutiny"
                      ? "bg-yellow-100 text-yellow-800"
                      : app.status === "eds"
                      ? "bg-green-100 text-green-800"
                      : app.status === "referred"
                      ? "bg-purple-100 text-purple-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {app.status.replace("_", " ").toUpperCase()}
                </span>
              </p>

              <div className="mb-4">
                <ApplicationTimeline currentStatus={app.status} />
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 className="text-sm font-semibold" style={{ marginTop: 0 }}>Scrutiny Checklist</h4>
                <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!checklistDrafts[app.id]?.documentsVerified}
                    onChange={(e) =>
                      setChecklistDrafts((prev) => ({
                        ...prev,
                        [app.id]: {
                          ...(prev[app.id] || { documentsVerified: false, paymentVerified: false, details: "" }),
                          documentsVerified: e.target.checked,
                        },
                      }))
                    }
                  />
                  Documents verified
                </label>

                <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!checklistDrafts[app.id]?.paymentVerified}
                    onChange={(e) =>
                      setChecklistDrafts((prev) => ({
                        ...prev,
                        [app.id]: {
                          ...(prev[app.id] || { documentsVerified: false, paymentVerified: false, details: "" }),
                          paymentVerified: e.target.checked,
                        },
                      }))
                    }
                  />
                  Payment verified
                </label>

                <textarea
                  className="textarea w-full"
                  rows={3}
                  placeholder="Checklist notes"
                  value={checklistDrafts[app.id]?.details || ""}
                  onChange={(e) =>
                    setChecklistDrafts((prev) => ({
                      ...prev,
                      [app.id]: {
                        ...(prev[app.id] || { documentsVerified: false, paymentVerified: false, details: "" }),
                        details: e.target.value,
                      },
                    }))
                  }
                />

                <button className="button button-secondary" type="button" onClick={() => saveChecklist(app)}>
                  Save Checklist
                </button>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 className="text-sm font-semibold" style={{ marginTop: 0 }}>EDS</h4>
                <textarea
                  className="textarea w-full"
                  rows={3}
                  placeholder="EDS remarks for proponent"
                  value={edsRemarks[app.id] || ""}
                  onChange={(e) => setEdsRemarks((prev) => ({ ...prev, [app.id]: e.target.value }))}
                />
                {app.eds?.responseNotes && (
                  <p className="text-sm" style={{ marginTop: 8 }}>
                    <strong>Latest PP Response:</strong> {app.eds.responseNotes}
                  </p>
                )}
                {app.eds?.resubmissionCount ? (
                  <p className="text-xs" style={{ color: "var(--muted)", marginTop: 4 }}>
                    Resubmissions: {app.eds.resubmissionCount}
                  </p>
                ) : null}
                <button className="button button-secondary" type="button" onClick={() => sendEDS(app)}>
                  Send EDS
                </button>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 className="text-sm font-semibold" style={{ marginTop: 0 }}>Backend Document Processing</h4>
                {processingHistory[app.id]?.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {processingHistory[app.id].slice(0, 2).map((run) => (
                      <div key={run.id} className="card" style={{ margin: 0 }}>
                        <p className="text-xs" style={{ margin: 0, color: "var(--muted)" }}>
                          Processed: {run.processedAt ? new Date(run.processedAt).toLocaleString() : "Unknown"}
                        </p>
                        <p className="text-sm" style={{ margin: "6px 0" }}>
                          Success: {run.okCount || 0}/{run.count || 0}
                        </p>
                        <div style={{ display: "grid", gap: 4 }}>
                          {(run.documents || []).map((doc, idx) => (
                            <p key={`${run.id}-${idx}`} className="text-xs" style={{ margin: 0 }}>
                              {doc.key || "document"}: {doc.ok ? "OK" : `Failed (${doc.error || "Unknown"})`}
                              {doc.ok && typeof doc.analysis?.pageCount === "number"
                                ? ` • pages: ${doc.analysis.pageCount}`
                                : ""}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ margin: 0, color: "var(--muted)" }}>
                    No backend processing run found yet for this application.
                  </p>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {app.status === "eds" ? (
                  <button
                    onClick={() => acceptResubmission(app)}
                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    Accept Resubmission
                  </button>
                ) : (
                  <button
                    onClick={() => updateStatus(app, "under_scrutiny")}
                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    Move Under Scrutiny
                  </button>
                )}

                <button
                  onClick={() => updateStatus(app, "referred")}
                  className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                >
                  Refer to Meeting
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </ProtectedRoute>
  );
}
