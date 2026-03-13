"use client";

import { useState } from "react";

export default function ProjectForm({
  projectName,
  setProjectName,
  location,
  setLocation,
  description,
  setDescription,
  files,
  setFiles,
  removeFile,
  handleSubmit,
  uploadProgress
}: any) {
  const [isDragActive, setIsDragActive] = useState(false);

  const addFiles = (newFiles: File[]) => {
    setFiles((prev: File[]) => [...prev, ...newFiles]);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    const dropped = Array.from(event.dataTransfer.files ?? []);
    const pdfs = dropped.filter((file) => file.type === "application/pdf");

    if (pdfs.length !== dropped.length) {
      alert("Only PDF files are allowed.");
    }

    if (pdfs.length > 0) {
      addFiles(pdfs);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  return (
    <section className="card">
      <h2>Submit New Project</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="field">
          <label>Project Name</label>
          <input
            className="input"
            type="text"
            placeholder="Enter project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Location</label>
          <input
            className="input"
            type="text"
            placeholder="Enter project location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            className="textarea"
            placeholder="Describe the project details"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        <div className="field">
          <label>Upload Documents</label>
          <div
            className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <p style={{ margin: 0 }}>
              Drag & drop PDFs here, or click to browse.
            </p>
            <input
              className="input"
              type="file"
              multiple
              accept=".pdf"
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                addFiles(selected);
              }}
            />
          </div>
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((file: any, index: number) => (
              <div className="file-item" key={index}>
                <span>{file.name}</span>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => removeFile(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {uploadProgress > 0 && (
          <div className="progress">Uploading: {uploadProgress}%</div>
        )}

        <button
          className="button"
          type="submit"
          disabled={uploadProgress > 0}
        >
          {uploadProgress > 0 ? `Uploading... ${uploadProgress}%` : "Submit Project"}
        </button>
      </form>
    </section>
  );
}
