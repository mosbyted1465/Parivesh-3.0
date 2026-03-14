"use client";

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import ProtectedRoute from "../../components/ProtectedRoute";
import ApplicationTimeline from "../../components/ApplicationTimeline";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { jsPDF } from "jspdf";
import {
  canTransition,
  isApplicationStatus,
  type ApplicationStatus,
} from "@/lib/workflow";
import {
  defaultTemplateForCategory,
  renderGistTemplate,
} from "@/lib/gist";

interface Application {
  id: string;
  projectName: string;
  location: string;
  description: string;
  category: string;
  sector: string;
  status: string;
  momText?: string;
  eds?: {
    remarks?: string;
    responseNotes?: string;
  };
  checklist?: {
    details?: string;
  };
}

interface GistTemplate {
  category: "A" | "B1" | "B2";
  template: string;
}

interface SectorParameter {
  sectorName: string;
  defaultNotes: string;
}

export default function MoMDashboard() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [gists, setGists] = useState<{ [key: string]: string }>({});
  const [generatingGist, setGeneratingGist] = useState<{ [key: string]: boolean }>({});

  const getTemplateForCategory = async (category: string): Promise<string> => {
    const normalized = ["A", "B1", "B2"].includes(category) ? category : "A";
    const templateRef = doc(db, "gistTemplates", normalized);
    const snapshot = await getDoc(templateRef);

    if (snapshot.exists()) {
      const data = snapshot.data() as GistTemplate;
      return data.template;
    }

    return defaultTemplateForCategory(normalized);
  };

  const getSectorNotes = async (sector: string): Promise<string> => {
    const sectorKey = sector.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const sectorRef = doc(db, "sectorParameters", sectorKey);
    const snapshot = await getDoc(sectorRef);

    if (snapshot.exists()) {
      const data = snapshot.data() as SectorParameter;
      return data.defaultNotes;
    }

    const fallback = await getDocs(
      query(collection(db, "sectorParameters"), where("sectorName", "==", sector))
    );

    if (!fallback.empty) {
      const data = fallback.docs[0].data() as SectorParameter;
      return data.defaultNotes;
    }

    return "No sector-specific notes configured by admin.";
  };

  const generateTemplateGist = async (app: Application): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const template = await getTemplateForCategory(app.category);
    const sectorNotes = await getSectorNotes(app.sector);

    return renderGistTemplate(template, {
      projectName: app.projectName,
      location: app.location,
      category: app.category,
      sector: app.sector,
      description: app.description,
      sectorNotes,
    });
  };

  const fetchApplications = async () => {
    try {
      const q = query(
        collection(db, "applications"),
        where("status", "in", ["referred", "mom_generated"])
      );
      const querySnapshot = await getDocs(q);
      const apps: Application[] = querySnapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<Application, "id">),
      }));
      setApplications(apps);

      const initialGists: { [key: string]: string } = {};
      for (const app of apps) {
        if ((app.momText || "").trim()) {
          initialGists[app.id] = app.momText || "";
          continue;
        }

        try {
          initialGists[app.id] = await generateTemplateGist(app);
        } catch (error) {
          console.error("Template gist generation failed, using fallback:", error);
          initialGists[app.id] = defaultTemplateForCategory(app.category);
        }
      }
      setGists(initialGists);
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTemplateGist = async (id: string) => {
    const app = applications.find((a) => a.id === id);
    if (!app) return;

    setGeneratingGist((prev) => ({ ...prev, [id]: true }));

    try {
      const generated = await generateTemplateGist(app);
      setGists((prev) => ({
        ...prev,
        [id]: generated,
      }));
    } catch (error) {
      console.error("Error generating template gist:", error);
      alert("Failed to generate gist from template.");
    } finally {
      setGeneratingGist((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleSaveMoM = async (id: string) => {
    try {
      const existing = applications.find((app) => app.id === id);

      if (!existing || !isApplicationStatus(existing.status)) {
        alert("Invalid application status.");
        return;
      }

      if (!canTransition(existing.status, "mom_generated")) {
        alert(`Transition not allowed: ${existing.status} -> mom_generated`);
        return;
      }

      const momText = gists[id] || "";
      const appRef = doc(db, "applications", id);
      await updateDoc(appRef, {
        momText,
        status: "mom_generated",
        updatedAt: new Date().toISOString(),
      });
      alert("MoM saved successfully.");
      await fetchApplications();
    } catch (error) {
      console.error("Error saving MoM:", error);
      alert("Failed to save MoM.");
    }
  };

  const handleFinalizeMoM = async (id: string) => {
    try {
      const existing = applications.find((app) => app.id === id);

      if (!existing || !isApplicationStatus(existing.status)) {
        alert("Invalid application status.");
        return;
      }

      if (!canTransition(existing.status as ApplicationStatus, "finalized")) {
        alert(`Transition not allowed: ${existing.status} -> finalized`);
        return;
      }

      const appRef = doc(db, "applications", id);
      await updateDoc(appRef, {
        status: "finalized",
        updatedAt: new Date().toISOString(),
      });
      alert("MoM finalized successfully.");
      await fetchApplications();
    } catch (error) {
      console.error("Error finalizing MoM:", error);
      alert("Failed to finalize MoM.");
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
    const docxFile = new Document({
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
              children: [new TextRun(app.momText || gists[app.id] || "No meeting text available.")],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(docxFile);
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
    const summaryText = app.momText || gists[app.id] || "No meeting text available.";
    const splitText = pdf.splitTextToSize(summaryText, 170);
    pdf.text(splitText, 20, 110);

    pdf.save(`MoM_${app.projectName}.pdf`);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setApplications([]);
        setGists({});
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
    <ProtectedRoute allowedRole="mom">
      <main className="container">
        <header className="header">
          <div>
            <h1 className="title">Minutes of Meeting (MoM) Dashboard</h1>
            <p className="subtitle">
              Generate and finalize meeting minutes for referred applications.
            </p>
            <p className="text-sm" style={{ marginTop: 8, color: "var(--muted)" }}>
              Role Scope: Edit template-generated gist and finalize MoM; no scrutiny checklist modifications.
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

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 className="text-sm font-semibold" style={{ marginTop: 0 }}>Scrutiny Inputs</h4>
                <p className="text-sm" style={{ marginBottom: 6 }}>
                  <strong>Scrutiny Remarks:</strong> {app.eds?.remarks || "Not provided"}
                </p>
                <p className="text-sm" style={{ marginBottom: 6 }}>
                  <strong>PP Response:</strong> {app.eds?.responseNotes || "Not provided"}
                </p>
                <p className="text-sm" style={{ marginBottom: 0 }}>
                  <strong>Checklist Notes:</strong> {app.checklist?.details || "Not provided"}
                </p>
              </div>

              <div className="mb-4">
                <ApplicationTimeline currentStatus={app.status} />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Meeting Gist</label>
                <textarea
                  className="textarea w-full"
                  rows={8}
                  value={gists[app.id] || ""}
                  onChange={(e) => setGists((prev) => ({ ...prev, [app.id]: e.target.value }))}
                  placeholder="Edit the meeting gist here..."
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleGenerateTemplateGist(app.id)}
                  disabled={generatingGist[app.id]}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingGist[app.id] ? "Generating..." : "Generate From Admin Template"}
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
              </div>
            </div>
          ))}
        </div>
      </main>
    </ProtectedRoute>
  );
}
