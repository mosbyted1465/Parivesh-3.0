"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";
import ProtectedRoute from "../../components/ProtectedRoute";
import ApplicationTimeline from "../../components/ApplicationTimeline";

interface Application {
  id: string;
  projectName: string;
  location: string;
  description: string;
  status: string;
}

export default function ScrutinyDashboard() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApplications = async () => {
    try {
      const q = query(collection(db, "applications"), where("status", "in", ["submitted", "under_scrutiny"]));
      const querySnapshot = await getDocs(q);
      const apps: Application[] = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Application[];
      setApplications(apps);
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const appRef = doc(db, "applications", id);
      await updateDoc(appRef, { status: newStatus });
      // Refresh the list
      await fetchApplications();
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status. Please try again.");
    }
  };

  useEffect(() => {
    fetchApplications();
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
            <p className="subtitle">
              Review and manage project applications.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {applications.map((app) => (
            <div key={app.id} className="card">
              <h3 className="text-lg font-semibold mb-2">{app.projectName}</h3>
              <p className="text-sm text-gray-600 mb-1">
                <strong>Location:</strong> {app.location}
              </p>
              <p className="text-sm text-gray-600 mb-2">
                <strong>Description:</strong> {app.description}
              </p>
              <p className="text-sm mb-4">
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
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => updateStatus(app.id, "under_scrutiny")}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  Approve
                </button>
                <button
                  onClick={() => updateStatus(app.id, "eds")}
                  className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                >
                  Send EDS
                </button>
                <button
                  onClick={() => updateStatus(app.id, "referred")}
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