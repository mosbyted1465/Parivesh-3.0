"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";
import ProtectedRoute from "../../components/ProtectedRoute";
import ApplicationTimeline from "../../components/ApplicationTimeline";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { jsPDF } from "jspdf";

interface Application {
  id: string;
  projectName: string;
  location: string;
  description: string;
  category: string;
  sector: string;
  status: string;
  momText?: string;
}

export default function MoMDashboard() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [gists, setGists] = useState<{ [key: string]: string }>({});
  const [generatingGist, setGeneratingGist] = useState<{ [key: string]: boolean }>({});

  const fetchApplications = async () => {
    try {
      const q = query(collection(db, "applications"), where("status", "in", ["referred", "mom_generated"]));
      const querySnapshot = await getDocs(q);
      const apps: Application[] = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Application[];
      setApplications(apps);

      // Generate initial gists
      const initialGists: { [key: string]: string } = {};
      for (const app of apps) {
        try {
          initialGists[app.id] = await generateAIGist(app);
        } catch (error) {
          // Fallback to basic gist if AI generation fails
          initialGists[app.id] = `Meeting Gist:
The committee reviewed the project titled "${app.projectName}" located at "${app.location}" under the "${app.sector}" sector. The project falls under category "${app.category}". The committee discussed environmental impacts and mitigation strategies based on the submitted documents.`;
        }
      }
      setGists(initialGists);
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateAIGist = async (app: Application): Promise<string> => {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const gist = `Meeting Gist:

The committee reviewed the project titled "${app.projectName}" located in "${app.location}". The project belongs to the "${app.sector}" sector and falls under category "${app.category}".

Project Overview:
${app.description}

The committee examined environmental impacts and mitigation strategies based on the submitted documentation and project description. Key considerations included ecological assessment, stakeholder consultations, and compliance with environmental regulations.

Discussion Points:
• Environmental impact assessment methodology
• Mitigation measures and monitoring plans
• Community engagement and grievance redressal
• Regulatory compliance and permitting requirements

The committee evaluated the project's alignment with sustainable development goals and environmental protection standards.`;

    return gist;
  };

  const handleGenerateAIGist = async (id: string) => {
    const app = applications.find((a) => a.id === id);
    if (!app) return;

    setGeneratingGist((prev) => ({ ...prev, [id]: true }));

    try {
      const aiGist = await generateAIGist(app);
      setGists((prev) => ({
        ...prev,
        [id]: aiGist,
      }));
    } catch (error) {
      console.error("Error generating AI gist:", error);
      alert("Failed to generate AI gist. Please try again.");
    } finally {
      setGeneratingGist((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleSaveMoM = async (id: string) => {
    try {
      const momText = gists[id] || "";
      const appRef = doc(db, "applications", id);
      await updateDoc(appRef, { momText, status: "mom_generated" });
      alert("MoM saved successfully!");
      await fetchApplications();
    } catch (error) {
      console.error("Error saving MoM:", error);
      alert("Failed to save MoM. Please try again.");
    }
  };

  const handleFinalizeMoM = async (id: string) => {
    try {
      const appRef = doc(db, "applications", id);
      await updateDoc(appRef, { status: "finalized" });
      alert("MoM finalized successfully!");
      await fetchApplications();
    } catch (error) {
      console.error("Error finalizing MoM:", error);
      alert("Failed to finalize MoM. Please try again.");
    }
  };

  const handleDownloadPdf = (appId: string) => {
    const app = applications.find((a) => a.id === appId);
    if (app) {
      generatePdf(app);
    }
  };

  const handleDownloadDocx = async (appId: string) => {
    const app = applications.find((a) => a.id === appId);
    if (app) {
      await generateDocx(app);
    }
  };

  const generateDocx = async (app: Application) => {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "Minutes of Meeting",
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Project Name: ", bold: true }),
                new TextRun(app.projectName),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Location: ", bold: true }),
                new TextRun(app.location),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Sector: ", bold: true }),
                new TextRun(app.sector),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Category: ", bold: true }),
                new TextRun(app.category),
              ],
            }),
            new Paragraph({
              text: "Meeting Summary:",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              children: [
                new TextRun(app.momText || "No meeting text available."),
              ],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const blob = new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MoM_${app.projectName}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generatePdf = (app: Application) => {
    const pdf = new jsPDF();
    pdf.setFontSize(20);
    pdf.text("Minutes of Meeting", 20, 30);

    pdf.setFontSize(12);
    pdf.text(`Project Name: ${app.projectName}`, 20, 50);
    pdf.text(`Location: ${app.location}`, 20, 60);
    pdf.text(`Sector: ${app.sector}`, 20, 70);
    pdf.text(`Category: ${app.category}`, 20, 80);

    pdf.setFontSize(14);
    pdf.text("Meeting Summary:", 20, 100);

    pdf.setFontSize(12);
    const splitText = pdf.splitTextToSize(app.momText || "No meeting text available.", 170);
    pdf.text(splitText, 20, 110);

    pdf.save(`MoM_${app.projectName}.pdf`);
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
    <ProtectedRoute allowedRole="mom">
      <main className="container">
        <header className="header">
          <div>
            <h1 className="title">Minutes of Meeting (MoM) Dashboard</h1>
            <p className="subtitle">
              Generate and finalize meeting minutes for referred applications.
            </p>
          </div>
        </header>

        <div className="space-y-6">
          {applications.map((app) => (
            <div key={app.id} className="card">
              <h3 className="text-xl font-semibold mb-4">{app.projectName}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <p><strong>Location:</strong> {app.location}</p>
                <p><strong>Category:</strong> {app.category}</p>
                <p><strong>Sector:</strong> {app.sector}</p>
                <p><strong>Status:</strong> {app.status}</p>
              </div>
              <p className="mb-4"><strong>Description:</strong> {app.description}</p>

              <div className="mb-4">
                <ApplicationTimeline currentStatus={app.status} />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Meeting Gist</label>
                <textarea
                  className="textarea w-full"
                  rows={6}
                  value={gists[app.id] || ""}
                  onChange={(e) => setGists((prev) => ({ ...prev, [app.id]: e.target.value }))}
                  placeholder="Edit the meeting gist here..."
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleGenerateAIGist(app.id)}
                  disabled={generatingGist[app.id]}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingGist[app.id] ? "Generating..." : "Generate AI Gist"}
                </button>
                <button
                  onClick={() => handleSaveMoM(app.id)}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Save MoM
                </button>
                <button
                  onClick={() => handleFinalizeMoM(app.id)}
                  className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  Finalize MoM
                </button>
                {app.momText && (
                  <>
                    <button
                      onClick={() => handleDownloadPdf(app.id)}
                      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Download PDF
                    </button>
                    <button
                      onClick={() => handleDownloadDocx(app.id)}
                      className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
                    >
                      Download DOCX
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
    </ProtectedRoute>
  );
}