"use client";
import { useState } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import ProtectedRoute from "../../components/ProtectedRoute";

export default function Page() {
  const [projectName, setProjectName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [sector, setSector] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();

    if (!projectName.trim() || !location.trim() || !description.trim() || !category.trim() || !sector.trim()) {
      alert("Please fill in all fields before submitting.");
      return;
    }

    setLoading(true);

    try {
      const docRef = await addDoc(collection(db, "applications"), {
        projectName,
        location,
        description,
        category,
        sector,
        status: "submitted",
        createdAt: serverTimestamp(),
      });

      alert(
        `Application submitted successfully! Your Application ID is: ${docRef.id}. You can track your application at /track`
      );

      setProjectName("");
      setLocation("");
      setDescription("");
      setCategory("");
      setSector("");
    } catch (error) {
      console.error("Error submitting application:", error);
      alert("Failed to submit application. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRole="proponent">
      <main className="container">
        <header className="header">
          <div>
            <h1 className="title">Apply for PARIVESH</h1>
            <p className="subtitle">
              Submit your project application with required documents for approval.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Project Name</label>
            <input
              className="input"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
            />
          </div>

          <div className="field">
            <label>Location</label>
            <input
              className="input"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Enter project location"
            />
          </div>

          <div className="field">
            <label>Description</label>
            <textarea
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the project details"
              rows={4}
            />
          </div>

          <div className="field">
            <label>Category</label>
            <input
              className="input"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Enter project category"
            />
          </div>

          <div className="field">
            <label>Sector</label>
            <input
              className="input"
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Enter project sector"
            />
          </div>

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Submitting..." : "Submit Application"}
          </button>
        </form>
      </main>
    </ProtectedRoute>
  );
}