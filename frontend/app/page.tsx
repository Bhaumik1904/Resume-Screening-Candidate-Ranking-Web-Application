"use client";

import { useState } from 'react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'text' | 'url'>('text');
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [results, setResults] = useState<any>(null);

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

  const handleUpload = async () => {
    if (files.length === 0 || (activeTab === 'text' && !jdText) || (activeTab === 'url' && !jdUrl)) return;
    
    setIsUploading(true);
    setUploadProgress(10);
    
    const formData = new FormData();
    if (activeTab === 'text') {
      formData.append('jobDescription', jdText);
    } else {
      // For now, we'll just pass the URL as text, but ideally the backend would scrape it.
      formData.append('jobDescription', jdUrl);
    }
    
    files.forEach(file => {
      formData.append('resumes', file);
    });

    try {
      setUploadStatus('Uploading resumes...');
      setUploadProgress(20);
      const res = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      
      const newJobId = data.jobId;
      setJobId(newJobId);
      setUploadProgress(50);
      
      // Trigger Analysis
      setUploadStatus('AI is analyzing candidates...');
      const analyzeRes = await fetch(`http://localhost:5000/api/analyze/${newJobId}`, {
        method: 'POST',
      });
      
      if (!analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        throw new Error(analyzeData.error || 'Analysis failed');
      }
      setUploadProgress(80);

      // Fetch Results
      setUploadStatus('Fetching final results...');
      const resultsRes = await fetch(`http://localhost:5000/api/results/${newJobId}`);
      if (!resultsRes.ok) throw new Error('Failed to fetch results');
      
      const resultsData = await resultsRes.json();
      setResults(resultsData);
      setUploadProgress(100);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
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

        {!results ? (
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

            <button 
              className="btn btn-primary" 
              disabled={files.length === 0 || (activeTab === 'text' && !jdText) || (activeTab === 'url' && !jdUrl) || isUploading}
              onClick={handleUpload}
            >
              {isUploading ? 'Uploading...' : 'Analyze Candidates 🚀'}
            </button>
          </section>
        ) : (
          <section className="dashboard">
            <div className="dashboard-header">
              <h2>Analysis Complete for "{results.jobTitle}"</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{results.stats.totalCandidates}</div>
                  <div className="stat-label">Total Candidates</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{results.stats.averageScore}</div>
                  <div className="stat-label">Avg Match Score</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{results.stats.topScore}</div>
                  <div className="stat-label">Top Score</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{results.stats.qualifiedCandidates}</div>
                  <div className="stat-label">Qualified (70+)</div>
                </div>
              </div>
            </div>

            <div className="dashboard-controls">
              <a href={`http://localhost:5000/api/results/${jobId}/export?format=csv`} className="btn btn-secondary btn-sm" download>
                Export CSV
              </a>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                setResults(null);
                setFiles([]);
                setJobId(null);
              }}>
                Start New Analysis
              </button>
            </div>

            <div className="candidates-grid">
              {results.candidates.map((candidate: any, idx: number) => {
                let badgeClass = 'default';
                if (idx === 0) badgeClass = 'gold';
                else if (idx === 1) badgeClass = 'silver';
                else if (idx === 2) badgeClass = 'bronze';

                return (
                  <div key={candidate.id} className="candidate-card">
                    <div className="candidate-card-header">
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <div className={`rank-badge ${badgeClass}`}>#{candidate.rank || idx + 1}</div>
                        <div>
                          <div className="candidate-name">{candidate.name}</div>
                          <div className="candidate-file">📄 {candidate.file_name}</div>
                        </div>
                      </div>
                      <div className="score-display">
                        <div className={`score-number ${candidate.total_score >= 80 ? 'high' : candidate.total_score >= 60 ? 'medium' : 'low'}`}>
                          {candidate.total_score}
                        </div>
                        <div className="score-label">Match Score</div>
                      </div>
                    </div>

                    <div className="main-score-bar">
                      <div 
                        className="main-score-fill" 
                        style={{ 
                          width: `${candidate.total_score}%`, 
                          background: candidate.total_score >= 80 ? '#34c759' : candidate.total_score >= 60 ? '#ff9500' : '#ff3b30' 
                        }} 
                      />
                    </div>

                    <div className="skills-section">
                      <div className="skills-label">Matched Skills</div>
                      <div className="skills-chips">
                        {candidate.matched_skills && candidate.matched_skills.map((skill: string, sIdx: number) => (
                          <span key={sIdx} className="chip chip-matched">{skill}</span>
                        ))}
                      </div>
                    </div>

                    <div className="skills-section">
                      <div className="skills-label">Missing Skills</div>
                      <div className="skills-chips">
                        {candidate.missing_skills && candidate.missing_skills.map((skill: string, sIdx: number) => (
                          <span key={sIdx} className="chip chip-missing">{skill}</span>
                        ))}
                      </div>
                    </div>

                    {candidate.summary && (
                      <p className="summary-text">{candidate.summary}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {isUploading && (
        <div className="progress-overlay">
          <div className="progress-card">
            <div className="progress-spinner"></div>
            <h3>{uploadStatus}</h3>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
