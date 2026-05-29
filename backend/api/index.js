let app;
try {
  app = require('../src/index');
} catch (err) {
  console.error('=== STARTUP CRASH ===', err.message, err.stack);
  // Export a fallback app that returns the error so it shows in Vercel logs
  const express = require('express');
  const fallback = express();
  fallback.use((req, res) => {
    res.status(500).json({ 
      error: 'Server failed to start', 
      reason: err.message,
      stack: err.stack,
    });
  });
  app = fallback;
}

module.exports = app;
