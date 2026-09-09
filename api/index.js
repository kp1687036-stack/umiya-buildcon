/**
 * ============================================================================
 * UMIYA BUILDCON - VERCEL SERVERLESS FUNCTION HANDLER
 * ============================================================================
 * This file serves all backend Express routes (/api/*, /admin) as a
 * Serverless Function on Vercel.
 * ============================================================================
 */

const app = require('../backend/server.js');

module.exports = app;
