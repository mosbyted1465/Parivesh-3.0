"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import ApplicationTimeline from "@/components/ApplicationTimeline";

interface Application {
  projectName: string;
  location: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function TrackApplication() {
  const [applicationId, setApplicationId] = useState("");
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicationId.trim()) return;

    setLoading(true);
    setError("");
    setApplication(null);

    try {
      const docRef = doc(db, "applications", applicationId.trim());
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        setApplication({
          projectName: data.projectName,
          location: data.location,
          description: data.description,
          status: data.status,
          createdAt: data.createdAt?.toDate?.()?.toLocaleDateString() || data.createdAt,
        });
      } else {
        setError("Application not found");
      }
    } catch (err) {
      console.error("Error fetching application:", err);
      setError("Failed to fetch application. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Track Your Application</h1>
          <p className="mt-2 text-gray-600">Enter your Application ID to check the status</p>
        </div>

        <div className="bg-white shadow-md rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="applicationId" className="block text-sm font-medium text-gray-700">
                Application ID
              </label>
              <input
                type="text"
                id="applicationId"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your application ID"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? "Searching..." : "Track Application"}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {application && (
            <div className="mt-6 space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Application Details</h2>
              <div className="space-y-3">
                <div>
                  <span className="font-medium text-gray-700">Project Name:</span>
                  <p className="text-gray-900">{application.projectName}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Location:</span>
                  <p className="text-gray-900">{application.location}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Description:</span>
                  <p className="text-gray-900">{application.description}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Status:</span>
                  <p className="text-gray-900 capitalize">{application.status.replace("_", " ")}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Created Date:</span>
                  <p className="text-gray-900">{application.createdAt}</p>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Application Progress</h3>
                <ApplicationTimeline currentStatus={application.status} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}