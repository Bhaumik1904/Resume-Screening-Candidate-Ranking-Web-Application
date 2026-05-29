"use client";

import { useState, useCallback } from 'react';

type ToastType = 'error' | 'success' | 'info';
interface Toast { id: number; message: string; type: ToastType; }
interface Candidate {
  id: string;
  name: string;
  file_name: string;
  total_score: number;
  skills_score: number;
  experience_score: number;
  education_score: number;
  keyword_score: number;
  matched_skills: string[];
  missing_skills: string[];
  summary: string;
  rank: number;
}
interface Results {
  jobTitle: string;
  jobId: string;
  stats: { totalCandidates: number; averageScore: number; topScore: number; qualifiedCandidates: number; };
  candidates: Candidate[];
}

let toastCounter = 0;

export default function Home() {
  const [activeTab, setActiveTab] = useState<'text' | 'url'>('text');
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapedJdText, setScrapedJdText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  // ─── Drag and Drop ────────────────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const addFiles = (newFiles: File[]) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt'];
    const valid = newFiles.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return allowed.includes(ext);
    });
    const rejected = newFiles.length - valid.length;
    if (rejected > 0) showToast(`${rejected} file(s) rejected. Only PDF, DOCX, and TXT files are supported.`, 'error');

    setFiles(prev => {
      // Deduplicate by name+size
      const existing = new Set(prev.map(f => f.name + f.size));
      const unique = valid.filter(f => !existing.has(f.name + f.size));
      if (unique.length < valid.length) showToast(`${valid.length - unique.length} duplicate file(s) skipped.`, 'info');
      return [...prev, ...unique];
    });
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  // ─── Upload & Analyze ─────────────────────────────────────────────────────────
  const handleUpload = async () => {
    let jd = activeTab === 'text' ? jdText : (scrapedJdText || jdUrl);

    // If URL tab is active and we haven't scraped yet, scrape first
    if (activeTab === 'url' && jdUrl.trim() && !scrapedJdText) {
      setIsScraping(true);
      try {
        const scrapeRes = await fetch('http://localhost:5000/api/scrape-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: jdUrl.trim() }),
        });
        const scrapeData = await scrapeRes.json();
        if (!scrapeRes.ok) throw new Error(scrapeData.error || 'Failed to fetch job URL');
        setScrapedJdText(scrapeData.description);
        jd = scrapeData.description;
        showToast(`Job description fetched: "${scrapeData.title}"`, 'success');
      } catch (err: any) {
        showToast(`Could not fetch URL: ${err.message}. Please paste the job description text instead.`, 'error');
        setActiveTab('text');
        setIsScraping(false);
        return;
      } finally {
        setIsScraping(false);
      }
    }

    if (files.length === 0 || !jd?.trim()) return;

    setIsUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append('jobDescription', jd);
    files.forEach(file => formData.append('resumes', file));

    try {
      setUploadStatus('Uploading resumes...');
      setUploadProgress(20);
      const uploadRes = await fetch('http://localhost:5000/api/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');

      const newJobId = uploadData.jobId;
      setJobId(newJobId);
      setUploadProgress(45);

      setUploadStatus(`Uploaded ${uploadData.candidatesUploaded} resume(s). AI is analyzing candidates...`);
      const analyzeRes = await fetch(`http://localhost:5000/api/analyze/${newJobId}`, { method: 'POST' });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error || 'Analysis failed');

      if (analyzeData.failed > 0 && analyzeData.scored === 0) {
        throw new Error(`AI analysis failed for all candidates. ${analyzeData.errors?.[0]?.error || 'Check your Gemini API key.'}`);
      }

      setUploadProgress(80);
      setUploadStatus('Fetching ranked results...');
      const resultsRes = await fetch(`http://localhost:5000/api/results/${newJobId}`);
      if (!resultsRes.ok) throw new Error('Failed to fetch results');

      const resultsData = await resultsRes.json();
      setResults(resultsData);
      setUploadProgress(100);

      if (analyzeData.failed > 0) {
        showToast(`${analyzeData.failed} resume(s) failed to analyze and were skipped.`, 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'An unexpected error occurred.', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setResults(null);
    setFiles([]);
    setJobId(null);
    setJdText('');
    setJdUrl('');
    setScrapedJdText('');
    setUploadProgress(0);
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="navbar-brand-icon">⌘</div>
          Resume Match
          <span className="navbar-badge">AI</span>
        </div>
        {results && (
          <button className="btn btn-secondary btn-sm" onClick={handleReset}>
            ← New Analysis
          </button>
        )}
      </nav>

      <main className="container">
        {!results && !isUploading && (
          <>
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

            <div className="how-it-works">
              <div className="hiw-step">
                <div className="hiw-icon">📝</div>
                <h3>1. Provide Job Details</h3>
                <p>Paste your job description or drop a link to the open role.</p>
              </div>
              <div className="hiw-divider">→</div>
              <div className="hiw-step">
                <div className="hiw-icon">📄</div>
                <h3>2. Upload Resumes</h3>
                <p>Drag and drop candidate resumes in bulk. PDF, DOCX, or TXT.</p>
              </div>
              <div className="hiw-divider">→</div>
              <div className="hiw-step">
                <div className="hiw-icon">✨</div>
                <h3>3. AI Ranking</h3>
                <p>Our AI scores and ranks every candidate by fit instantly.</p>
              </div>
            </div>
          </>
        )}

        {!results ? (
          <section className="upload-section">
            {/* Job Description Card */}
            <div className="card">
              <div className="card-label"><span>📝</span> Job Description</div>

              <div className="jd-tabs">
                <button className={`jd-tab ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>Paste Text</button>
                <button className={`jd-tab ${activeTab === 'url' ? 'active' : ''}`} onClick={() => setActiveTab('url')}>URL</button>
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
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="url"
                      className="jd-input"
                      placeholder="https://in.indeed.com/viewjob?jk=..."
                      value={jdUrl}
                      onChange={(e) => { setJdUrl(e.target.value); setScrapedJdText(''); }}
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        if (!jdUrl.trim()) return;
                        setIsScraping(true);
                        try {
                          const res = await fetch('http://localhost:5000/api/scrape-url', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: jdUrl.trim() }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error);
                          setScrapedJdText(data.description);
                          showToast(`✅ Fetched: "${data.title}"`, 'success');
                        } catch (err: any) {
                          // Auto-switch to paste tab so user can copy-paste manually
                          setActiveTab('text');
                          showToast(
                            (err.message || 'Could not fetch the URL.') +
                            ' Switching to paste mode — copy the job description from your browser and paste it here.',
                            'error'
                          );
                        } finally {
                          setIsScraping(false);
                        }
                      }}
                      disabled={isScraping || !jdUrl.trim()}
                      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {isScraping ? '⏳ Fetching...' : '🔗 Fetch JD'}
                    </button>
                  </div>
                  {scrapedJdText ? (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600, marginBottom: '6px' }}>
                        ✅ Job description fetched ({scrapedJdText.length} chars) — ready to analyze
                      </div>
                      <textarea
                        className="jd-textarea"
                        value={scrapedJdText}
                        onChange={(e) => setScrapedJdText(e.target.value)}
                        style={{ minHeight: '140px' }}
                      />
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '10px' }}>
                      Paste a link from Indeed, LinkedIn, Glassdoor, or any job board and click <strong>Fetch JD</strong>.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Resumes Upload Card */}
            <div className="card">
              <div className="card-label"><span>📄</span> Resumes <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— upload up to 20 at once</span></div>

              <div
                className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="upload-icon">📁</div>
                <h3>Drag & drop resumes here</h3>
                <p>
                  or{' '}
                  <label htmlFor="file-upload" className="upload-browse-btn">browse files</label>
                  <input
                    id="file-upload"
                    type="file"
                    style={{ display: 'none' }}
                    multiple
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        addFiles(Array.from(e.target.files));
                        e.target.value = '';
                      }
                    }}
                  />
                </p>
                <p style={{ marginTop: '8px', fontSize: '0.8rem' }}>Supports text-based PDF, DOCX, TXT · Max 10MB each</p>
                <p style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--warning)' }}>⚠️ Scanned or image-based PDFs are not supported</p>
              </div>

              {files.length > 0 && (
                <div className="file-list">
                  {files.map((file, i) => (
                    <div key={`${file.name}-${file.size}-${i}`} className="file-chip">
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
              disabled={files.length === 0 || (activeTab === 'text' && !jdText.trim()) || (activeTab === 'url' && !jdUrl.trim()) || isUploading}
              onClick={handleUpload}
            >
              Analyze {files.length > 0 ? `${files.length} Candidate${files.length > 1 ? 's' : ''}` : 'Candidates'} 🚀
            </button>
          </section>
        ) : (
          <section className="dashboard">
            <div className="dashboard-header">
              <h2>Analysis Complete — <em>{results.jobTitle}</em></h2>
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
              <a
                href={`http://localhost:5000/api/results/${jobId}/export?format=csv`}
                className="btn btn-secondary btn-sm"
                download
              >
                ⬇ Export CSV
              </a>
              <a
                href={`http://localhost:5000/api/results/${jobId}/export?format=excel`}
                className="btn btn-secondary btn-sm"
                download
              >
                ⬇ Export Excel
              </a>
              <button className="btn btn-secondary btn-sm" onClick={handleReset}>
                ＋ New Analysis
              </button>
            </div>

            <div className="candidates-grid">
              {results.candidates.map((candidate, idx) => {
                let badgeClass = 'default';
                if (idx === 0) badgeClass = 'gold';
                else if (idx === 1) badgeClass = 'silver';
                else if (idx === 2) badgeClass = 'bronze';

                const scoreColor = candidate.total_score >= 80 ? '#34c759' : candidate.total_score >= 60 ? '#ff9500' : '#ff3b30';

                return (
                  <div key={candidate.id} className="candidate-card" style={{ animationDelay: `${idx * 0.07}s` }}>
                    <div className="candidate-card-header">
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
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
                        <div className="score-label">/ 100</div>
                      </div>
                    </div>

                    {/* Main progress bar */}
                    <div className="main-score-bar">
                      <div className="main-score-fill" style={{ width: `${candidate.total_score}%`, background: scoreColor }} />
                    </div>

                    {/* Sub-score breakdown */}
                    <div className="score-bar-container">
                      {[
                        { label: 'Skills',     value: candidate.skills_score,     color: '#6366f1' },
                        { label: 'Experience', value: candidate.experience_score,  color: '#8b5cf6' },
                        { label: 'Education',  value: candidate.education_score,   color: '#06b6d4' },
                        { label: 'Keywords',   value: candidate.keyword_score,     color: '#10b981' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="score-bar-row">
                          <span className="score-bar-label">{label}</span>
                          <div className="score-bar-track">
                            <div
                              className="score-bar-fill"
                              style={{ width: `${(value / 25) * 100}%`, background: color }}
                            />
                          </div>
                          <span className="score-bar-val">{value}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/25</span></span>
                        </div>
                      ))}
                    </div>

                    {/* Matched Skills */}
                    {candidate.matched_skills && candidate.matched_skills.length > 0 && (
                      <div className="skills-section">
                        <div className="skills-label">✅ Matched Skills</div>
                        <div className="skills-chips">
                          {candidate.matched_skills.map((skill, sIdx) => (
                            <span key={sIdx} className="chip chip-matched">{skill}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Missing Skills */}
                    {candidate.missing_skills && candidate.missing_skills.length > 0 && (
                      <div className="skills-section">
                        <div className="skills-label">⚠️ Missing / Gaps</div>
                        <div className="skills-chips">
                          {candidate.missing_skills.map((skill, sIdx) => (
                            <span key={sIdx} className="chip chip-missing">{skill}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI Summary */}
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

      {/* Loading Overlay */}
      {isUploading && (
        <div className="progress-overlay">
          <div className="progress-card">
            <div className="progress-spinner"></div>
            <h3>{uploadStatus}</h3>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
            </div>
            <p style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              This may take 10–30 seconds per resume…
            </p>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="toast-stack">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              {toast.type === 'error' ? '❌' : toast.type === 'success' ? '✅' : 'ℹ️'}
            </span>
            <span className="toast-msg">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            >×</button>
          </div>
        ))}
      </div>
    </>
  );
}
