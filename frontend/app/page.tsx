"use client";

import { useState } from 'react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'text' | 'url'>('text');
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Handlers for drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="navbar-brand-icon">⌘</div>
          Resume Match
          <span className="navbar-badge">Beta</span>
        </div>
        <div>
          <button className="btn btn-secondary btn-sm">Dashboard</button>
        </div>
      </nav>

      <main className="container">
        <section className="hero">
          <div className="hero-pill">
            <span>✨</span> AI-Powered Candidate Screening
          </div>
          <h1 className="hero-title">Find the perfect match, faster.</h1>
          <p className="hero-subtitle">
            Upload resumes and paste a job description. Our AI analyzes candidate 
            skills, experience, and fit in seconds, delivering ranked results you can trust.
          </p>
        </section>

        <section className="upload-section">
          {/* Job Description Card */}
          <div className="card">
            <div className="card-label">
              <span>📝</span> Job Description
            </div>
            
            <div className="jd-tabs">
              <button 
                className={`jd-tab ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTab('text')}
              >
                Text
              </button>
              <button 
                className={`jd-tab ${activeTab === 'url' ? 'active' : ''}`}
                onClick={() => setActiveTab('url')}
              >
                URL
              </button>
            </div>

            {activeTab === 'text' ? (
              <div>
                <textarea 
                  className="jd-textarea" 
                  placeholder="Paste the job description here..."
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                />
                <div className="jd-char-count">{jdText.length} chars</div>
              </div>
            ) : (
              <div>
                <input 
                  type="url" 
                  className="jd-input" 
                  placeholder="https://company.com/careers/job-123"
                  value={jdUrl}
                  onChange={(e) => setJdUrl(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Resumes Upload Card */}
          <div className="card">
            <div className="card-label">
              <span>📄</span> Resumes
            </div>

            <div 
              className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="upload-icon">📁</div>
              <h3>Drag & drop resumes here</h3>
              <p>
                or <label className="upload-browse-btn">browse files<input type="file" hidden multiple accept=".pdf,.doc,.docx,.txt" onChange={(e) => {
                  if (e.target.files) {
                    setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                  }
                }} /></label>
              </p>
              <p style={{ marginTop: '8px', fontSize: '0.8rem' }}>Supports PDF, DOCX, TXT</p>
            </div>

            {files.length > 0 && (
              <div className="file-list">
                {files.map((file, i) => (
                  <div key={i} className="file-chip">
                    <span className="file-chip-icon">📄</span>
                    <span className="file-chip-name">{file.name}</span>
                    <span className="file-chip-size">{(file.size / 1024).toFixed(1)} KB</span>
                    <button className="file-chip-remove" onClick={() => removeFile(i)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn btn-primary" disabled={files.length === 0 || (activeTab === 'text' && !jdText) || (activeTab === 'url' && !jdUrl)}>
            Analyze Candidates 🚀
          </button>
        </section>
      </main>
    </>
  );
}
