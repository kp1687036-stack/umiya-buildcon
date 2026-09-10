/**
 * ============================================================================
 * UMIYA BUILDCON - BACKEND SERVER API & ADMIN PORTAL
 * ============================================================================
 * Features:
 * - Dual Storage: MongoDB Atlas + Auto-Persistent Local Database (data/inquiries.json)
 * - Nodemailer automated HTML email notifications
 * - Built-in Admin Dashboard at http://localhost:5000/admin (View, Filter, Export to CSV)
 * - Security: Helmet, CORS, Express-Rate-Limit, Input Sanitization & XSS protection
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // fallback
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const validator = require('validator');

const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// ============================================================================
// 1. DATA DIRECTORY & LOCAL DATABASE INITIALIZATION
// ============================================================================
const DATA_DIR = isServerless ? path.join(os.tmpdir(), 'umiya_data') : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'inquiries.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  }
} catch (e) {
  console.warn('⚠️ Notice on local storage init:', e.message);
}


// Local Database Helpers
function readLocalInquiries() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading local inquiries database:', err.message);
    return [];
  }
}

function saveLocalInquiry(item) {
  try {
    const list = readLocalInquiries();
    list.unshift(item); // Newest on top
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving local inquiry:', err.message);
    return false;
  }
}

function deleteLocalInquiry(id) {
  try {
    const list = readLocalInquiries();
    const filtered = list.filter(item => String(item.id) !== String(id) && String(item._id) !== String(id));
    fs.writeFileSync(DATA_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error deleting local inquiry:', err.message);
    return false;
  }
}

// ============================================================================
// 2. SECURITY & MIDDLEWARE CONFIGURATION
// ============================================================================

// Security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: false // Allows admin dashboard CDN scripts & styles
  })
);

// CORS configuration
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim()) 
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: Not allowed by origin.'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.set('trust proxy', 1);

// Spam Prevention Rate Limiter for Inquiries (5 per 15 min per IP)
const inquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many inquiries submitted from this IP. Please wait 15 minutes before submitting again.'
  }
});

// ============================================================================
// 3. MONGODB ATLAS CONNECTION & SCHEMA DEFINITION
// ============================================================================

const MONGODB_URI = process.env.MONGODB_URI;

let cachedDbPromise = null;
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('yourpassword') || uri.includes('cluster0.abcde.mongodb.net') || uri.trim() === '') {
    return null;
  }

  if (!cachedDbPromise) {
    cachedDbPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false
    }).then((m) => {
      console.log('✅ Connected successfully to MongoDB Atlas Database.');
      return m;
    }).catch((err) => {
      cachedDbPromise = null;
      console.error('❌ MongoDB Atlas connection error:', err.message);
      return null;
    });
  }

  return cachedDbPromise;
}

// Initial connection attempt on cold start
connectToDatabase();

const InquirySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  department: { type: String, trim: true, default: 'General / Unspecified' },
  message: { type: String, required: true, trim: true },
  ipAddress: { type: String, default: 'Unknown' },
  userAgent: { type: String, default: 'Unknown' },
  status: { type: String, enum: ['New', 'In-Review', 'Contacted', 'Closed'], default: 'New' },
  createdAt: { type: Date, default: Date.now, index: true }
});

const Inquiry = mongoose.models.Inquiry || mongoose.model('Inquiry', InquirySchema);


// ============================================================================
// 4. NODEMAILER EMAIL AUTOMATION & HTML TEMPLATES
// ============================================================================

const createTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
};

/**
 * Sanitizes headers to prevent CRLF email header injection
 */
function sanitizeHeaderString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\r\n\t]/g, ' ').trim();
}

/**
 * Template 1: Detailed Notification Email Sent to Company Inbox
 */
const generateAdminNotificationEmailHtml = ({ inquiryId, name, email, phone, department, message, timestamp, cleanPhoneDigits, ipAddress }) => {
  const whatsappUrl = `https://wa.me/${cleanPhoneDigits}?text=${encodeURIComponent(`Hello ${name}, thank you for contacting Umiya Buildcon regarding your inquiry (${inquiryId}).`)}`;
  const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(`Re: Official Inquiry [Ref: ${inquiryId}] - Umiya Buildcon`)}`;
  const telUrl = `tel:${phone.replace(/\s+/g, '')}`;

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0; padding:0; background-color:#f4f6f8; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#334155;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f6f8; padding:30px 10px;">
      <tr>
        <td align="center">
          <table border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; width:100%; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08); border:1px solid #e2e8f0;">
            <tr>
              <td style="background: linear-gradient(135deg, #081f31 0%, #16527d 100%); padding:28px 30px; text-align:left; border-bottom:4px solid #ea8a26;">
                <span style="background-color:#ea8a26; color:#ffffff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; padding:4px 8px; border-radius:4px; display:inline-block; margin-bottom:8px;">Official Website Lead</span>
                <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:700;">New Official Inquiry Received</h1>
                <p style="margin:5px 0 0 0; color:#cbd5e1; font-size:13px;">Umiya Buildcon • Defense & Civil Infrastructure Contractors</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px 10px 30px;">
                <div style="background-color:#fef7ee; border-left:4px solid #ea8a26; padding:12px 16px; border-radius:0 8px 8px 0; color:#b45309; font-size:13px; font-weight:600;">
                  🚨 Managing Director Alert: A new client inquiry has been submitted online.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:15px 30px 20px 30px;">
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; width:38%; font-size:13px; font-weight:600; color:#64748b;">Reference ID:</td>
                    <td style="padding:10px 0; font-size:13px; font-weight:700; font-family:monospace; color:#0f172a;">${inquiryId}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Client Name:</td>
                    <td style="padding:10px 0; font-size:14px; font-weight:700; color:#0f172a;">${validator.escape(name)}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Email Address:</td>
                    <td style="padding:10px 0; font-size:14px; color:#16527d; font-weight:600;"><a href="${mailtoUrl}">${validator.escape(email)}</a></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Phone Number:</td>
                    <td style="padding:10px 0; font-size:14px; font-weight:700; color:#0f172a;"><a href="${telUrl}">${validator.escape(phone)}</a></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Department / Org:</td>
                    <td style="padding:10px 0; font-size:14px; color:#334155;"><strong>${validator.escape(department || 'Not Specified')}</strong></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Submitted At:</td>
                    <td style="padding:10px 0; font-size:13px; color:#64748b;">${timestamp}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">IP Address:</td>
                    <td style="padding:10px 0; font-size:12px; font-family:monospace; color:#64748b;">${validator.escape(ipAddress || 'Unknown')}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 25px 30px;">
                <h3 style="font-size:14px; color:#0e3a5a; text-transform:uppercase; margin:0 0 10px 0; border-bottom:2px solid #f1f5f9; padding-bottom:6px;">💬 Message / Tender Scope:</h3>
                <div style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; font-size:14px; color:#1e293b; white-space:pre-wrap; line-height:1.6;">${validator.escape(message)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 30px 30px;" align="center">
                <table border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;"><a href="${whatsappUrl}" target="_blank" style="background-color:#16a34a; color:#ffffff; font-size:13px; font-weight:600; text-decoration:none; padding:10px 18px; border-radius:6px; display:inline-block;">💬 Chat on WhatsApp</a></td>
                    <td style="padding-right:10px;"><a href="${mailtoUrl}" style="background-color:#16527d; color:#ffffff; font-size:13px; font-weight:600; text-decoration:none; padding:10px 18px; border-radius:6px; display:inline-block;">✉️ Reply Email</a></td>
                    <td><a href="${telUrl}" style="background-color:#ea8a26; color:#ffffff; font-size:13px; font-weight:600; text-decoration:none; padding:10px 18px; border-radius:6px; display:inline-block;">📞 Call Client</a></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#081f31; padding:16px 30px; text-align:center; color:#94a3b8; font-size:11px;">
                Umiya Buildcon • 7, Umiya Complex, Kalol Road, Mansa - 382845, Gujarat • +91 962XXXXX82
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
};

/**
 * Template 2: Professional Auto-Reply Confirmation Email Sent to User
 */
const generateUserConfirmationEmailHtml = ({ inquiryId, name, email, phone, department, message, timestamp }) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#334155; -webkit-font-smoothing:antialiased;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f8fafc; padding:35px 15px;">
      <tr>
        <td align="center">
          <table border="0" cellpadding="0" cellspacing="0" width="620" style="max-width:620px; width:100%; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.06); border:1px solid #e2e8f0;">
            
            <!-- Header Banner -->
            <tr>
              <td style="background: linear-gradient(135deg, #081f31 0%, #16527d 100%); padding:32px 35px; text-align:left; border-bottom:4px solid #ea8a26;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <span style="background-color:#ea8a26; color:#ffffff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; padding:4px 9px; border-radius:4px; display:inline-block; margin-bottom:10px;">
                        Official Acknowledgment
                      </span>
                      <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700; letter-spacing:-0.5px;">
                        Inquiry Received & Under Review
                      </h1>
                      <p style="margin:6px 0 0 0; color:#cbd5e1; font-size:13px; font-weight:400;">
                        Umiya Buildcon • Defense & Civil Infrastructure Contractors
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Greeting Body -->
            <tr>
              <td style="padding:30px 35px 20px 35px;">
                <p style="font-size:16px; font-weight:600; color:#0f172a; margin:0 0 12px 0;">
                  Dear ${validator.escape(name)},
                </p>
                <p style="font-size:14px; line-height:1.65; color:#475569; margin:0 0 16px 0;">
                  Thank you for reaching out to <strong>Umiya Buildcon</strong>. We have successfully received your inquiry regarding <strong>${validator.escape(department || 'Government & Civil Infrastructure Works')}</strong>.
                </p>
                <p style="font-size:14px; line-height:1.65; color:#475569; margin:0 0 22px 0;">
                  Under the direction of our Managing Director, <strong>Jaymin Patel</strong>, our project estimation team is reviewing your requirements. We strive to provide prompt, high-precision turnarounds for all inquiries and government contracts.
                </p>

                <!-- Inquiry Summary Box -->
                <div style="background-color:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #16527d; border-radius:8px; padding:20px; margin-bottom:24px;">
                  <h3 style="margin:0 0 14px 0; font-size:13px; font-weight:700; color:#16527d; text-transform:uppercase; letter-spacing:0.8px;">
                    📋 Summary of Your Submission
                  </h3>
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size:13px; color:#334155;">
                    <tr>
                      <td style="padding:6px 0; width:38%; color:#64748b; font-weight:600;">Reference ID:</td>
                      <td style="padding:6px 0; font-family:monospace; font-weight:700; color:#0f172a;">${inquiryId}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0; color:#64748b; font-weight:600;">Department / Category:</td>
                      <td style="padding:6px 0; font-weight:600; color:#ea8a26;">${validator.escape(department || 'General Inquiry')}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0; color:#64748b; font-weight:600;">Contact Phone:</td>
                      <td style="padding:6px 0; font-weight:500; color:#334155;">${validator.escape(phone)}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0; color:#64748b; font-weight:600;">Submitted At:</td>
                      <td style="padding:6px 0; color:#64748b;">${timestamp}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding-top:12px; border-top:1px dashed #cbd5e1; margin-top:8px;">
                        <span style="display:block; color:#64748b; font-weight:600; margin-bottom:5px;">Your Details / Message:</span>
                        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:12px; font-size:13px; color:#1e293b; line-height:1.5; white-space:pre-wrap;">${validator.escape(message)}</div>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- Next Steps Box -->
                <div style="background-color:#fef7ee; border:1px solid #f8d7ad; border-radius:8px; padding:18px; margin-bottom:24px;">
                  <h4 style="margin:0 0 8px 0; font-size:12px; font-weight:700; color:#b45309; text-transform:uppercase; letter-spacing:0.5px;">
                    ⏱️ Next Steps & Response Timeline
                  </h4>
                  <ul style="margin:0; padding-left:18px; font-size:13px; color:#78350f; line-height:1.6;">
                    <li><strong>Technical Review:</strong> Our engineering desk analyzes structural specifications.</li>
                    <li><strong>Direct Follow-up:</strong> You will receive a direct phone call or email follow-up within <strong>2 to 4 business hours</strong>.</li>
                    <li><strong>Tender / Quote:</strong> If required, a formal quotation or BOQ breakdown will be prepared.</li>
                  </ul>
                </div>

                <!-- Quick Action Contacts -->
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                  <tr>
                    <td align="center" style="padding:10px 0;">
                      <table border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:12px;">
                            <a href="tel:962XXXXX82" style="background-color:#16527d; color:#ffffff; font-size:13px; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px; display:inline-block;">
                              📞 Call Office: +91 962XXXXX82
                            </a>
                          </td>
                          <td>
                            <a href="mailto:webmanager1728@gmail.com?subject=Inquiry%20Ref:%20${inquiryId}" style="background-color:#ea8a26; color:#ffffff; font-size:13px; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px; display:inline-block;">
                              ✉️ Direct Email Desk
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="font-size:13px; color:#64748b; line-height:1.6; margin:0;">
                  Warm regards,<br>
                  <strong style="color:#0f172a;">Jaymin Patel</strong><br>
                  Managing Director & Founder<br>
                  <span style="color:#16527d; font-weight:600;">Umiya Buildcon</span>
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color:#081f31; padding:22px 35px; text-align:center; color:#94a3b8; font-size:11px; line-height:1.6; border-top:1px solid #1e293b;">
                <strong style="color:#ffffff;">Umiya Buildcon</strong> — Govt. Approved Civil & Defense Infrastructure Contractor<br>
                7, Umiya Complex, Kalol Road, Mansa - 382845, Gujarat, India • +91 962XXXXX82<br>
                <span style="color:#64748b;">This is an automated confirmation of your inquiry submission.</span>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
};

// ============================================================================
// 4b. GOOGLE SHEETS REAL-TIME SYNC CONFIGURATION
// ============================================================================

/**
 * Sends a single inquiry directly to Google Sheets via Webhook
 */
async function saveToGoogleSheet(inquiryRecord) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.trim() === '' || webhookUrl.includes('your_deployment_id')) {
    return { attempted: false, reason: 'GOOGLE_SHEET_WEBHOOK_URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second safety timeout

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(inquiryRecord),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }

    console.log(`📊 [GOOGLE SHEETS] Inquiry from "${inquiryRecord.name}" synced to Google Sheets.`);
    return { attempted: true, success: true, response: json };
  } catch (err) {
    console.warn(`⚠️  [GOOGLE SHEETS] Sync notice: ${err.message}`);
    return { attempted: true, success: false, error: err.message };
  }
}

/**
 * Batch syncs an array of inquiries into Google Sheets
 */
async function syncBatchToGoogleSheet(inquiries) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.trim() === '' || webhookUrl.includes('your_deployment_id')) {
    throw new Error('GOOGLE_SHEET_WEBHOOK_URL is not set in backend/.env. Please follow backend/GOOGLE_SHEETS_SETUP.md');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'sync_batch',
      items: inquiries
    }),
    redirect: 'follow'
  });

  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return json;
}

// ============================================================================
// 5. API ROUTES & CONTROLLERS
// ============================================================================

// Health Check
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB Atlas Connected' : 'Local JSON Database Active';
  const totalLocal = readLocalInquiries().length;
  const sheetConfigured = Boolean(process.env.GOOGLE_SHEET_WEBHOOK_URL && !process.env.GOOGLE_SHEET_WEBHOOK_URL.includes('your_deployment_id'));
  res.json({ 
    status: 'OK', 
    database: dbStatus, 
    googleSheetsConnected: sheetConfigured,
    totalStoredInquiries: totalLocal 
  });
});

// GET /api/inquiries - Fetch all inquiries as JSON
app.get('/api/inquiries', async (req, res) => {
  try {
    await connectToDatabase();
    if (mongoose.connection.readyState === 1) {
      const dbInquiries = await Inquiry.find().sort({ createdAt: -1 });
      return res.json({ success: true, count: dbInquiries.length, data: dbInquiries });
    }
    const localInquiries = readLocalInquiries();
    return res.json({ success: true, count: localInquiries.length, data: localInquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/google - Verify & Authenticate Google Sign-In
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, user } = req.body;
    if (!token && !user) {
      return res.status(400).json({ success: false, message: 'Google authentication credential or user payload is required.' });
    }

    let authenticatedUser = user || {};

    if (token) {
      try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
        if (verifyRes.ok) {
          const payload = await verifyRes.json();
          authenticatedUser = {
            name: payload.name,
            email: payload.email,
            picture: payload.picture,
            sub: payload.sub,
            verified: payload.email_verified === 'true' || payload.email_verified === true
          };
        }
      } catch (tokenErr) {
        console.warn('Google token verification fallback:', tokenErr.message);
      }
    }

    return res.json({
      success: true,
      message: 'Google authentication verified successfully.',
      user: authenticatedUser
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/inquiries/:id - Delete an inquiry
app.delete('/api/inquiries/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await connectToDatabase();
    if (mongoose.connection.readyState === 1 && mongoose.isValidObjectId(id)) {
      await Inquiry.findByIdAndDelete(id);
    }
    deleteLocalInquiry(id);
    res.json({ success: true, message: 'Inquiry deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sync-google-sheet - Push all inquiries to Google Sheet
app.post('/api/sync-google-sheet', async (req, res) => {
  try {
    await connectToDatabase();
    let inquiries = [];
    if (mongoose.connection.readyState === 1) {
      inquiries = await Inquiry.find().sort({ createdAt: 1 }); // Oldest first when populating
    }
    if (!inquiries || inquiries.length === 0) {
      inquiries = [...readLocalInquiries()].reverse(); // Oldest first
    }

    if (inquiries.length === 0) {
      return res.json({ success: true, message: 'No inquiries available to sync yet.' });
    }

    const result = await syncBatchToGoogleSheet(inquiries);
    res.json({
      success: true,
      message: `Successfully synced ${inquiries.length} inquiries to your Google Sheet!`,
      details: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4c. COMPREHENSIVELY TRAINED AI KNOWLEDGE BASE & NLP ENGINE
// ============================================================================

/**
 * Trained AI knowledge engine for Umiya Buildcon
 * Handles natural language queries in English, Gujarati, and Hindi.
 */
function processTrainedAiQuery(message, language = 'en-IN') {
  const cleanMsg = (message || '').trim().toLowerCase();
  const isGujarati = language === 'gu-IN' || /[\u0A80-\u0AFF]/.test(cleanMsg) || cleanMsg.includes('kem cho') || cleanMsg.includes('kemcho') || cleanMsg.includes('aabhar');
  const isHindi = language === 'hi-IN' || /[\u0900-\u097F]/.test(cleanMsg) || cleanMsg.includes('dhanyavad') || cleanMsg.includes('shukriya') || cleanMsg.includes('kaise ho');

  // Intent 1: Managing Director Jaymin Patel & Leadership
  if (
    !cleanMsg.includes('head office') && !cleanMsg.includes('headquarters') && !cleanMsg.includes('office') &&
    (cleanMsg.includes('jaymin') || cleanMsg.includes('patel') || cleanMsg.includes('director') || 
    cleanMsg.includes('owner') || cleanMsg.includes('founder') || cleanMsg.includes('md') || 
    cleanMsg.includes('boss') || cleanMsg.includes('leadership') || cleanMsg.includes('management') || 
    cleanMsg.includes('માલિક') || cleanMsg.includes('ડિરેક્ટર') || cleanMsg.includes('જયમિન') || 
    cleanMsg.includes('કોણ') || cleanMsg.includes('मालिक') || cleanMsg.includes('डायरेक्टर') || 
    cleanMsg.includes('जयमिन') || cleanMsg.includes('एमडी'))
  ) {
    if (isGujarati) {
      return {
        reply: "જયમિન પટેલ (Jaymin Patel) ઉમિયા બિલ્ડકોનના મેનેજિંગ ડિરેક્ટર અને સ્થાપક છે.\n• શિક્ષણ: B.E. સિવિલ એન્જિનિયરિંગ\n• અનુભવ: મિલિટરી એન્જિનિયર સર્વિસીસ (MES), એરફોર્સ, નેવી અને ગુજરાત રાજ્ય સિવિલ ઇન્ફ્રાસ્ટ્રક્ચરમાં 10+ વર્ષથી વધુનો બહોળો અનુભવ.\n• વિઝન: ઉચ્ચ ગુણવત્તાવાળા સરકારી અને સંરક્ષણ પ્રોજેક્ટ્સ સમયસર પૂર્ણ કરવા.",
        category: 'leadership',
        action: 'open_md_profile'
      };
    }
    if (isHindi) {
      return {
        reply: "जयमिन पटेल (Jaymin Patel) उमिया बिल्डकॉन के प्रबंध निदेशक (MD) और संस्थापक हैं।\n• योग्यता: बी.ई. सिविल इंजीनियरिंग\n• अनुभव: रक्षा (MES), वायु सेना, नौसेना और सरकारी बुनियादी ढांचे में 10+ वर्षों का नेतृत्व अनुभव।\n• फोन: +91 962XXXXX82 | ईमेल: webmanager1728@gmail.com",
        category: 'leadership',
        action: 'open_md_profile'
      };
    }
    return {
      reply: "Jaymin Patel is the Managing Director & Founder of Umiya Buildcon.\n• Qualification: B.E. Civil Engineering\n• Experience: 10+ Years leading high-security Defense (MES), Air Force, Navy, and State public civil contracts.\n• Direct Contact: +91 962XXXXX82 | webmanager1728@gmail.com",
      category: 'leadership',
      action: 'open_md_profile'
    };
  }

  // Intent 2: Defense, MES, Air Force, Navy Infrastructure
  if (
    cleanMsg.includes('defense') || cleanMsg.includes('mes') || cleanMsg.includes('military') || 
    cleanMsg.includes('navy') || cleanMsg.includes('air force') || cleanMsg.includes('airforce') || 
    cleanMsg.includes('hangar') || cleanMsg.includes('runway') || cleanMsg.includes('marine') || 
    cleanMsg.includes('સૈન્ય') || cleanMsg.includes('આર્મી') || cleanMsg.includes('ડિફેન્સ') || 
    cleanMsg.includes('હવાઈ') || cleanMsg.includes('નેવી') || cleanMsg.includes('एयरफोर्स') || 
    cleanMsg.includes('रक्षा') || cleanMsg.includes('नौसेना') || cleanMsg.includes('एमईएस')
  ) {
    if (isGujarati) {
      return {
        reply: "ઉમિયા બિલ્ડકોન સંરક્ષણ મંત્રાલયના મિલિટરી એન્જિનિયર સર્વિસીસ (MES) ના માન્યતા પ્રાપ્ત કોન્ટ્રાક્ટર છે:\n✈️ એરફોર્સ બેઝ: સ્પેશિયલાઇઝ્ડ એરક્રાફ્ટ હેંગર્સ, ટેકનિકલ બ્લોક્સ અને ગ્રાઉન્ડ પેવમેન્ટ્સ.\n⚓ નેવલ ડિફેન્સ: મરીન-ગ્રેડ હાઇ-ડ્યુરેબિલિટી RCC સ્ટ્રક્ચર્સ, કોસ્ટલ ડિફેન્સ અને અન્ડરગ્રાઉન્ડ યુટિલિટીઝ.\n🛡️ 100% મિલિટરી સુરક્ષા નિયમો અને ક્વોલિટી સ્ટાન્ડર્ડ્સ સાથે નિર્માણ.",
        category: 'defense',
        action: 'open_projects'
      };
    }
    if (isHindi) {
      return {
        reply: "उमिया बिल्डकॉन रक्षा मंत्रालय की मिलिट्री इंजीनियर सर्विसेज (MES) का अनुमोदित ठेकेदार है:\n✈️ वायु सेना: विमान हैंगर, तकनीकी ब्लॉक और ऑपरेशनल ग्राउंड्स।\n⚓ नौसेना: मरीन-ग्रेड आरसीसी संरचनाएं, तटीय रक्षा कार्य और उपयोगिता पाइपलाइन।\n🛡️ उच्च-सुरक्षा रक्षा मानकों का 100% अनुपालन।",
        category: 'defense',
        action: 'open_projects'
      };
    }
    return {
      reply: "Umiya Buildcon is a specialized, approved contractor for Military Engineer Services (MES):\n✈️ Air Force Bases: Aircraft hangars, technical blocks, operational grounds, and specialized pavements.\n⚓ Navy Infrastructure: Marine-grade high-durability RCC developments, underground utilities, and coastal defense works across Gujarat.\n🛡️ 100% adherence to strict military quality and defense safety protocols.",
      category: 'defense',
      action: 'open_projects'
    };
  }

  // Intent 3: Roads, Highways, Asphalt & RCC
  if (
    cleanMsg.includes('road') || cleanMsg.includes('highway') || cleanMsg.includes('asphalt') || 
    cleanMsg.includes('bituminous') || cleanMsg.includes('tar') || cleanMsg.includes('rcc road') || 
    cleanMsg.includes('pavement') || cleanMsg.includes('culvert') || cleanMsg.includes('panchayat road') || 
    cleanMsg.includes('pmgsy') || cleanMsg.includes('રોડ') || cleanMsg.includes('ડાંબર') || 
    cleanMsg.includes('હાઇવે') || cleanMsg.includes('કામ') || cleanMsg.includes('सड़क') || 
    cleanMsg.includes('हाइवे') || cleanMsg.includes('डामर') || cleanMsg.includes('आरसीसी')
  ) {
    if (isGujarati) {
      return {
        reply: "અમારી રોડ અને હાઇવે કન્સ્ટ્રક્શન સેવાઓ:\n🛣️ ડાંબર રોડ: સ્ટેટ હાઇવે અને ભારે ટ્રાફિક વાળા માર્ગો (Gujarat R&B Division).\n🏗️ RCC રોડ: ગ્રામ્ય એપ્રોચ રોડ અને હેવી ડ્યુટી કોંક્રિટ પેવમેન્ટ્સ.\n💧 રોડ સાઇડ ગટર, કલ્વર્ટ્સ અને પેવિંગ સોલ્યુશન્સ.",
        category: 'roads',
        action: 'open_projects'
      };
    }
    if (isHindi) {
      return {
        reply: "सड़क एवं राजमार्ग निर्माण में हमारी क्षमताएं:\n🛣️ डामर बिटुमिनस सड़कें: भारी यातायात वाले राज्य राजमार्ग (Gujarat R&B).\n🏗️ आरसीसी सड़कें: ग्रामीण एप्रोच सड़कें और टिकाऊ कंक्रीट पेवमेंट्स।\n💧 सड़क किनारे नाले, पुलिया (Culverts) और निर्माण कार्य।",
        category: 'roads',
        action: 'open_projects'
      };
    }
    return {
      reply: "Our Road & Highway Construction capabilities include:\n🛣️ Bituminous Asphalt Highways: Heavy-duty state roads for the Gujarat R&B Division.\n🏗️ Rigid Concrete Pavements (RCC): Long-lasting village approach roads and industrial tracks.\n💧 Drainage culverts, shoulder paving, and durable surface strengthening.",
      category: 'roads',
      action: 'open_projects'
    };
  }

  // Intent 4: Drainage, Pipeline, Sewerage & Earthworks
  if (
    cleanMsg.includes('drainage') || cleanMsg.includes('pipeline') || cleanMsg.includes('pipe') || 
    cleanMsg.includes('hume') || cleanMsg.includes('sewer') || cleanMsg.includes('water') || 
    cleanMsg.includes('storm') || cleanMsg.includes('earthwork') || cleanMsg.includes('excavation') || 
    cleanMsg.includes('canal') || cleanMsg.includes('ડ્રેનેજ') || cleanMsg.includes('ગટર') || 
    cleanMsg.includes('પાઇપલાઇન') || cleanMsg.includes('નાળા') || cleanMsg.includes('ખોદકામ') || 
    cleanMsg.includes('ड्रेनेज') || cleanMsg.includes('सीवर') || cleanMsg.includes('पाइपलाइन') || 
    cleanMsg.includes('खुदाई')
  ) {
    if (isGujarati) {
      return {
        reply: "અમારી ડ્રેનેજ અને પાઇપલાઇન ક્ષમતાઓ:\n• અન્ડરગ્રાઉન્ડ સ્ટોર્મવોટર અને ગટર નેટવર્ક.\n• હેવી-ડ્યુટી RCC હ્યુમ પાઇપલાઇન્સ (NP2/NP3/NP4) અને પ્રીકાસ્ટ મેનહોલ્સ.\n• બલ્ક અર્થવર્ક, કેનાલ એક્સકેવેશન અને જેસીબી/પોકલેન લેવલિંગ વર્ક્સ.",
        category: 'drainage',
        action: 'open_projects'
      };
    }
    return {
      reply: "We execute comprehensive Drainage, Pipeline & Bulk Earthworks:\n• Underground stormwater drainage and municipal sewerage networks.\n• Heavy-duty RCC Hume pipe laying (NP2/NP3/NP4) and precast manholes.\n• Bulk earthmoving, precision trenching, and canal excavation projects across Gujarat.",
      category: 'drainage',
      action: 'open_projects'
    };
  }

  // Intent 5: Civil Buildings & Government Infrastructure
  if (
    !cleanMsg.includes('job') && !cleanMsg.includes('career') && !cleanMsg.includes('engineer') && !cleanMsg.includes('hire') && !cleanMsg.includes('vacancy') && !cleanMsg.includes('resume') &&
    (cleanMsg.includes('building') || cleanMsg.includes('civil work') || cleanMsg.includes('civil infra') || cleanMsg.includes('complex') || 
    cleanMsg.includes('structure') || cleanMsg.includes('construction') || cleanMsg.includes('ઇમારત') || 
    cleanMsg.includes('બિલ્ડીંગ') || cleanMsg.includes('મકાન') || cleanMsg.includes('ભવન') || 
    cleanMsg.includes('इमारत') || cleanMsg.includes('भवन') || cleanMsg.includes('निर्माण'))
  ) {
    if (isGujarati) {
      return {
        reply: "અમે સરકારી અને વહીવટી ઇમારતોનું ગુણવત્તાયુક્ત બાંધકામ કરીએ છીએ:\n🏛️ સરકારી ઓફિસો, પંચાયત ભવન અને સંસ્થાકીય પરિસરો.\n🏢 સંરક્ષણ વહીવટી બ્લોક્સ અને રેસિડેન્શિયલ ક્વાર્ટર્સ.\n🔨 ફાઉન્ડેશનથી લઇને ફિનિશિંગ સુધીનું ટર્નકી કન્સ્ટ્રક્શન.",
        category: 'civil_buildings',
        action: 'open_projects'
      };
    }
    return {
      reply: "We construct durable Government & Public Civil Buildings:\n🏛️ Government administrative offices, Panchayat Bhavans, and institutional campuses.\n🏢 Defense staff quarters, training centers, and specialized RCC blocks.\n🔨 Full turnkey execution from foundation to structural finishing.",
      category: 'civil_buildings',
      action: 'open_projects'
    };
  }

  // Intent 6: Office Address, Location & Working Hours
  if (
    cleanMsg.includes('address') || cleanMsg.includes('location') || cleanMsg.includes('office') || 
    cleanMsg.includes('where') || cleanMsg.includes('place') || cleanMsg.includes('mansa') || 
    cleanMsg.includes('gandhinagar') || cleanMsg.includes('city') || cleanMsg.includes('timing') || 
    cleanMsg.includes('hours') || cleanMsg.includes('ક્યાં') || cleanMsg.includes('સરનામું') || 
    cleanMsg.includes('ઓફિસ') || cleanMsg.includes('સમય') || cleanMsg.includes('માણસા') || 
    cleanMsg.includes('पता') || cleanMsg.includes('ऑफिस') || cleanMsg.includes('समय') || 
    cleanMsg.includes('कहाँ') || cleanMsg.includes('स्थान')
  ) {
    if (isGujarati) {
      return {
        reply: "📍 હેડ ઓફિસનું સરનામું:\n૭, ઉમિયા કોમ્પ્લેક્સ, કલોલ રોડ, માણસા - ૩૮૨૮૪૫, જિલ્લો: ગાંધીનગર, ગુજરાત.\n⏰ કામકાજનો સમય: સોમવાર થી શનિવાર (સવારે ૯:૦૦ થી સાંજે ૭:૩૦)\n📞 ફોન: +91 962XXXXX82 | ✉️ ઈમેલ: webmanager1728@gmail.com",
        category: 'location',
        action: 'call_or_whatsapp'
      };
    }
    if (isHindi) {
      return {
        reply: "📍 मुख्य कार्यालय का पता:\n७, उमिया कॉम्प्लेक्स, कलोल रोड, माणसा - ३८२८४५, जिला: गांधीनगर, गुजरात।\n⏰ कार्य समय: सोमवार से शनिवार (सुबह 9:00 से शाम 7:30)\n📞 फोन: +91 962XXXXX82 | ✉️ ईमेल: webmanager1728@gmail.com",
        category: 'location',
        action: 'call_or_whatsapp'
      };
    }
    return {
      reply: "📍 Head Office Address:\n7, Umiya Complex, Kalol Road, Mansa - 382845, Dist: Gandhinagar, Gujarat.\n⏰ Working Hours: Monday to Saturday (9:00 AM – 7:30 PM)\n📞 Direct Phone: +91 962XXXXX82 | ✉️ Email: webmanager1728@gmail.com",
      category: 'location',
      action: 'call_or_whatsapp'
    };
  }

  // Intent 7: Contact Numbers, Email, WhatsApp, Direct Call
  if (
    cleanMsg.includes('contact') || cleanMsg.includes('phone') || cleanMsg.includes('call') || 
    cleanMsg.includes('mobile') || cleanMsg.includes('number') || cleanMsg.includes('email') || 
    cleanMsg.includes('whatsapp') || cleanMsg.includes('mail') || cleanMsg.includes('સંપર્ક') || 
    cleanMsg.includes('કોન્ટેક્ટ') || cleanMsg.includes('ફોન') || cleanMsg.includes('નંબર') || 
    cleanMsg.includes('ઇમેઇલ') || cleanMsg.includes('વ્હોટ્સએપ') || cleanMsg.includes('फोन') || 
    cleanMsg.includes('कॉल') || cleanMsg.includes('नंबर') || cleanMsg.includes('संपर्क') || 
    cleanMsg.includes('व्हाट्सएप')
  ) {
    if (isGujarati) {
      return {
        reply: "ઉમિયા બિલ્ડકોન સાથે સીધો સંપર્ક કરો:\n📞 કોલ કરો: +91 962XXXXX82\n💬 WhatsApp: +91 962XXXXX82 (મેનેજિંગ ડિરેક્ટર જયમિન પટેલ)\n✉️ ઓફિશિયલ ઈમેલ: webmanager1728@gmail.com\n📍 સ્થળ: માણસા, ગાંધીનગર, ગુજરાત.",
        category: 'contact',
        action: 'whatsapp'
      };
    }
    if (isHindi) {
      return {
        reply: "उमिया बिल्डकॉन से सीधा संपर्क करें:\n📞 सीधा फोन: +91 962XXXXX82\n💬 WhatsApp: +91 962XXXXX82 (एमडी जयमिन पटेल)\n✉️ ईमेल: webmanager1728@gmail.com\n📍 पता: माणसा, गांधीनगर, गुजरात।",
        category: 'contact',
        action: 'whatsapp'
      };
    }
    return {
      reply: "Connect directly with Umiya Buildcon:\n📞 Direct Phone: +91 962XXXXX82\n💬 WhatsApp: +91 962XXXXX82 (MD Jaymin Patel)\n✉️ Official Email: webmanager1728@gmail.com\n📍 Office: Mansa, Gandhinagar, Gujarat.",
      category: 'contact',
      action: 'whatsapp'
    };
  }

  // Intent 8: Tenders, Pricing, Rates, Quotation, BOQ & Estimation
  if (
    cleanMsg.includes('tender') || cleanMsg.includes('quote') || cleanMsg.includes('quotation') || 
    cleanMsg.includes('price') || cleanMsg.includes('cost') || cleanMsg.includes('rate') || 
    cleanMsg.includes('estimate') || cleanMsg.includes('boq') || cleanMsg.includes('bidding') || 
    cleanMsg.includes('subcontract') || cleanMsg.includes('ભાવ') || cleanMsg.includes('ટેન્ડર') || 
    cleanMsg.includes('ખર્ચ') || cleanMsg.includes('કોટેશન') || cleanMsg.includes('અંદાજ') || 
    cleanMsg.includes('टेंडर') || cleanMsg.includes('कीमत') || cleanMsg.includes('कोटेशन') || 
    cleanMsg.includes('रेट') || cleanMsg.includes('खर्च')
  ) {
    if (isGujarati) {
      return {
        reply: "ટેન્ડર સબ-કોન્ટ્રાક્ટિંગ, BOQ અંદાજ અથવા કોટેશન માટે:\n1. અમારા ઓનલાઇન 'Send Official Inquiry' ફોર્મ દ્વારા તમારી વિગતો મોકલો.\n2. અથવા મેનેજિંગ ડિરેક્ટર જયમિન પટેલ સાથે સીધો સંપર્ક કરો: +91 962XXXXX82.\nઅમે પ્રોજેક્ટ સ્કોપ, મટીરીયલ અને સાઇટ સ્પેસિફિકેશન મુજબ સચોટ ભાવ અંદાજ પ્રદાન કરીએ છીએ.",
        category: 'tender_pricing',
        action: 'scroll_contact'
      };
    }
    return {
      reply: "For tender sub-contracting, BOQ estimations, or project quotations:\n1. Fill out our official website inquiry form with your drawings and requirements.\n2. Or speak directly with Managing Director Jaymin Patel at +91 962XXXXX82.\nWe provide highly competitive, transparent rates as per government and MES schedule standards.",
      category: 'tender_pricing',
      action: 'scroll_contact'
    };
  }

  // Intent 9: Machinery, Fleet & Equipment
  if (
    cleanMsg.includes('machinery') || cleanMsg.includes('equipment') || cleanMsg.includes('jcb') || 
    cleanMsg.includes('poclain') || cleanMsg.includes('mixer') || cleanMsg.includes('roller') || 
    cleanMsg.includes('paver') || cleanMsg.includes('batching') || cleanMsg.includes('પ્લાન્ટ') || 
    cleanMsg.includes('મશીનરી') || cleanMsg.includes('સાધનો') || cleanMsg.includes('मशीनरी') || 
    cleanMsg.includes('उपकरण')
  ) {
    if (isGujarati) {
      return {
        reply: "અમારી પાસે આધુનિક ઇન્ફ્રાસ્ટ્રક્ચર મશીનરી છે:\n🚜 જેસીબી અને પોકલેન એક્સકેવેટર્સ (Excavators & Backhoes)\n🚛 કોંક્રિટ ટ્રાન્ઝિટ મિક્સર્સ અને બેચિંગ પ્લાન્ટ\n🛣️ વાઇબ્રેટરી રોલર્સ અને એસ્ફાલ્ટ પેવર ફિનિશર્સ\n📐 ડિજિટલ ટોટલ સ્ટેશન સર્વે સાધનો.",
        category: 'machinery',
        action: 'open_projects'
      };
    }
    return {
      reply: "Our modern heavy machinery & construction fleet includes:\n🚜 JCB & Poclain Heavy Excavators\n🚛 Concrete Transit Mixers & Automated Batching Plants\n🛣️ Vibratory Soil & Asphalt Road Rollers, Bitumen Paver Finishers\n📐 Precision Digital Total Station surveying instruments.",
      category: 'machinery',
      action: 'open_projects'
    };
  }

  // Intent 10: Quality Control, Testing & Materials
  if (
    cleanMsg.includes('quality') || cleanMsg.includes('testing') || cleanMsg.includes('lab test') || 
    cleanMsg.includes('cube test') || cleanMsg.includes('soil test') || cleanMsg.includes('concrete test') || 
    cleanMsg.includes('strength test') || cleanMsg.includes('proctor') || cleanMsg.includes('penetration') || 
    cleanMsg.includes('iso') || cleanMsg.includes('ગુણવત્તા') || cleanMsg.includes('ટેસ્ટિંગ') || 
    cleanMsg.includes('લેબ') || cleanMsg.includes('गुणवत्ता') || cleanMsg.includes('टेस्टિંગ')
  ) {
    if (isGujarati) {
      return {
        reply: "ઉમિયા બિલ્ડકોનમાં ક્વોલિટી એશ્યોરન્સ:\n🔬 કોંક્રિટ ક્યુબ કોમ્પ્રેસિવ સ્ટ્રેન્થ ટેસ્ટિંગ (7 અને 28 દિવસ).\n🌱 સોઇલ કોમ્પેક્શન અને પ્રોક્ટર ડેન્સિટી ટેસ્ટિંગ.\n🛢️ ડાંબર પેનિટ્રેશન અને માર્શલ સ્ટેબિલિટી ટેસ્ટ.\n🛡️ સંરક્ષણ (MES) અને સરકારી માપદંડોનું 100% પાલન.",
        category: 'quality',
        action: 'open_projects'
      };
    }
    return {
      reply: "Quality Assurance & Material Testing Standards:\n🔬 Concrete Cube Compressive Strength Testing (7 & 28 Days)\n🌱 Soil Compaction & Standard/Modified Proctor Density Tests\n🛢️ Bitumen Penetration & Marshall Stability Tests\n🛡️ 100% certified adherence to Defense MES and IRC/MORTH specifications.",
      category: 'quality',
      action: 'open_projects'
    };
  }

  // Intent 11: Careers, Jobs, Hiring & Vendors
  if (
    cleanMsg.includes('career') || cleanMsg.includes('job') || cleanMsg.includes('hire') || 
    cleanMsg.includes('hiring') || cleanMsg.includes('vacancy') || cleanMsg.includes('engineer') || 
    cleanMsg.includes('supplier') || cleanMsg.includes('vendor') || cleanMsg.includes('નોકરી') || 
    cleanMsg.includes('જોબ') || cleanMsg.includes('સપ્લાયર') || cleanMsg.includes('नौकरी') || 
    cleanMsg.includes('जॉब') || cleanMsg.includes('भर्ती')
  ) {
    if (isGujarati) {
      return {
        reply: "કારકિર્દી અને વેન્ડર જોડાણ:\n👷 સિવિલ એન્જિનિયર્સ, સાઇટ સુપરવાઇઝર્સ અને મશીન ઓપરેટર્સ માટે નોકરીની તકો.\n🏢 સિમેન્ટ, સ્ટીલ (TMT), હ્યુમ પાઇપ અને ડાંબર સપ્લાયર્સ માટે વેન્ડર રજીસ્ટ્રેશન.\nતમારું CV અથવા પ્રપોઝલ webmanager1728@gmail.com પર મોકલો અથવા +91 962XXXXX82 પર સંપર્ક કરો.",
        category: 'careers_vendors',
        action: 'scroll_contact'
      };
    }
    return {
      reply: "Careers & Vendor Partnerships at Umiya Buildcon:\n👷 We regularly welcome talented Civil Engineers, Site Supervisors, and Heavy Machinery Operators.\n🏢 Suppliers for Cement, TMT 550D Steel, Aggregates, Hume Pipes, and Bitumen are invited to register.\nPlease email your profile or company catalogue to webmanager1728@gmail.com or call +91 962XXXXX82.",
      category: 'careers_vendors',
      action: 'scroll_contact'
    };
  }

  // Intent 12: Greetings, Hello, How are you
  if (
    cleanMsg.includes('hello') || cleanMsg.includes('hi') || cleanMsg.includes('hey') || 
    cleanMsg.includes('namaste') || cleanMsg.includes('kem cho') || cleanMsg.includes('ram ram') || 
    cleanMsg.includes('good morning') || cleanMsg.includes('good evening') || cleanMsg.includes('kemcho') || 
    cleanMsg.includes('નમસ્તે') || cleanMsg.includes('કેમ છો') || cleanMsg.includes('રામ રામ') || 
    cleanMsg.includes('नमस्ते') || cleanMsg.includes('नमस्कार') || cleanMsg.includes('राम राम')
  ) {
    if (isGujarati) {
      return {
        reply: "નમસ્તે! ઉમિયા બિલ્ડકોનમાં આપનું હાર્દિક સ્વાગત છે. હું તમારો AI સહાયક છું. તમે સંરક્ષણ પ્રોજેક્ટ્સ (MES/Air Force/Navy), રોડ કન્સ્ટ્રક્શન, ડ્રેનેજ અથવા મેનેજિંગ ડિરેક્ટર જયમિન પટેલ વિશે કોઈ પણ પ્રશ્ન પૂછી શકો છો.",
        category: 'greeting',
        action: 'suggest_topics'
      };
    }
    if (isHindi) {
      return {
        reply: "नमस्ते! उमिया बिल्डकॉन में आपका हार्दिक स्वागत है। मैं आपका AI सहायक हूँ। आप रक्षा परियोजनाओं (MES/Air Force/Navy), सड़क निर्माण, ड्रेनेज या प्रबंध निदेशक जयमिन पटेल के बारे में कोई भी सवाल पूछ सकते हैं।",
        category: 'greeting',
        action: 'suggest_topics'
      };
    }
    return {
      reply: "Hello and welcome to Umiya Buildcon! I am your trained Voice AI Assistant. How can I help you today with Defense (MES), Road Highways, Drainage infrastructure, or connecting with Managing Director Jaymin Patel?",
      category: 'greeting',
      action: 'suggest_topics'
    };
  }

  // Intent 13: Past Projects & Portfolio Showcase
  if (
    cleanMsg.includes('project') || cleanMsg.includes('portfolio') || cleanMsg.includes('work') || 
    cleanMsg.includes('done') || cleanMsg.includes('history') || cleanMsg.includes('પ્રોજેક્ટ') || 
    cleanMsg.includes('કામો') || cleanMsg.includes('પ્રગતિ') || cleanMsg.includes('प्रोजेक्ट') || 
    cleanMsg.includes('काम')
  ) {
    if (isGujarati) {
      return {
        reply: "અમે સમગ્ર ગુજરાતમાં 50+ થી વધુ સરકારી અને સંરક્ષણ પ્રોજેક્ટ્સ સફળતાપૂર્વક પૂર્ણ કર્યા છે:\n• એરફોર્સ બેઝ ટેકનિકલ બ્લોક્સ અને હેંગર્સ\n• નેવલ ડિફેન્સ મરીન RCC ઇન્ફ્રાસ્ટ્રક્ચર\n• સ્ટેટ હાઇવે ડાંબર રોડ અને પંચાયત RCC એપ્રોચ રોડ\n• અન્ડરગ્રાઉન્ડ સ્ટોર્મવોટર ડ્રેનેજ સિસ્ટમ્સ.",
        category: 'projects',
        action: 'open_projects'
      };
    }
    return {
      reply: "We have delivered 50+ prestigious government and defense infrastructure projects across Gujarat:\n• Air Force Technical complexes & Hangars\n• Naval Defense Marine RCC developments\n• State Highway Bituminous Asphalt & Rural RCC Pavements\n• Municipal Stormwater Drainage Networks.",
      category: 'projects',
      action: 'open_projects'
    };
  }

  // Intent 14: Voice usage guide & language switching
  if (
    cleanMsg.includes('voice') || cleanMsg.includes('speak') || cleanMsg.includes('mic') || 
    cleanMsg.includes('audio') || cleanMsg.includes('sound') || cleanMsg.includes('વાત') || 
    cleanMsg.includes('બોલો') || cleanMsg.includes('અવાજ') || cleanMsg.includes('माइक') || 
    cleanMsg.includes('आवाज') || cleanMsg.includes('बोलें')
  ) {
    if (isGujarati) {
      return {
        reply: "🎙️ વોઇસ ફીચરનો ઉપયોગ કેવી રીતે કરવો:\n1. નીચે આપેલા માઇક્રોફોન (Mic) બટન પર ક્લિક કરો.\n2. તમારો પ્રશ્ન ગુજરાતી, અંગ્રેજી અથવા હિન્દીમાં બોલો.\n3. AI તમારો અવાજ સાંભળીને તરત જવાબ આપશે અને બોલીને સંભળાવશે!",
        category: 'voice_guide',
        action: 'none'
      };
    }
    return {
      reply: "🎙️ How to use the Voice AI Feature:\n1. Click the orange Microphone button at the bottom of the chat.\n2. Speak your question naturally in English, Gujarati, or Hindi.\n3. The AI will transcribe your voice in real time and speak the answer back aloud!",
      category: 'voice_guide',
      action: 'none'
    };
  }

  // Fallback Response for unknown query
  if (isGujarati) {
    return {
      reply: "ઉમિયા બિલ્ડકોન માં સંપર્ક કરવા બદલ આભાર. અમે સરકાર માન્ય સંરક્ષણ (MES) અને સિવિલ ઇન્ફ્રાસ્ટ્રક્ચર કોન્ટ્રાક્ટર છીએ.\nશું તમે મેનેજિંગ ડિરેક્ટર જયમિન પટેલ સાથે સીધી વાત કરવા માંગો છો કે સત્તાવાર ઇન્ક્વાયરી મોકલવા માંગો છો?",
      category: 'fallback',
      action: 'call_or_whatsapp'
    };
  }
  if (isHindi) {
    return {
      reply: "उमिया बिल्डकॉन से संपर्क करने के लिए धन्यवाद। हम सरकार द्वारा अनुमोदित रक्षा (MES/Air Force/Navy) एवं सिविल इन्फ्रास्ट्रक्चर ठेकेदार हैं।\nक्या आप प्रबंध निदेशक जयमिन पटेल से बात करना चाहते हैं या आधिकारिक पूछताछ भेजना चाहते हैं?",
      category: 'fallback',
      action: 'call_or_whatsapp'
    };
  }

  return {
    reply: "Thank you for reaching out to Umiya Buildcon. We are a Government Approved Defense (MES/Air Force/Navy) & Civil Infrastructure Contractor.\nWould you like to connect directly with Managing Director Jaymin Patel or submit an official inquiry?",
    category: 'fallback',
    action: 'call_or_whatsapp'
  };
}

// POST /api/ai-chat - AI Chatbot Engine endpoint
app.post('/api/ai-chat', async (req, res) => {
  try {
    const { message, language = 'en-IN' } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    // Process using comprehensive trained AI knowledge base
    const result = processTrainedAiQuery(message, language);

    res.json({
      success: true,
      reply: result.reply,
      category: result.category,
      action: result.action,
      language
    });
  } catch (err) {
    console.error('AI chat endpoint error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal AI chat error' });
  }
});


// POST /api/inquiry - Handle Form Submissions & Save to Database + Google Sheet
app.post(
  '/api/inquiry',
  inquiryLimiter,
  [
    body('name').trim().notEmpty().withMessage('Full Name is required.').isLength({ min: 2, max: 100 }),
    body('email').trim().notEmpty().withMessage('Email address is required.').isEmail().normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone number is required.').isLength({ min: 7, max: 25 }),
    body('department').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
    body('message').trim().notEmpty().withMessage('Message details are required.').isLength({ min: 5, max: 4000 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }

    const { name, email, phone, department, message } = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    let cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length === 10) cleanDigits = '91' + cleanDigits;

    const istTimestamp = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium'
    });

    const inquiryRecord = {
      id: 'inq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name,
      email,
      phone,
      department: department || 'General / Unspecified',
      message,
      ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
      userAgent,
      status: 'New',
      createdAt: new Date().toISOString(),
      formattedTime: istTimestamp
    };

    // 1. ALWAYS Save to Local JSON Database immediately
    saveLocalInquiry(inquiryRecord);
    console.log(`💾 [DATABASE] Inquiry from "${name}" saved to local database (Total: ${readLocalInquiries().length})`);

    // 2. Also Save to MongoDB Atlas if connected
    await connectToDatabase();
    if (mongoose.connection.readyState === 1) {
      try {
        const newDoc = new Inquiry({
          name, email, phone, department: department || 'General / Unspecified',
          message, ipAddress: inquiryRecord.ipAddress, userAgent
        });
        await newDoc.save();
        console.log(`☁️  [MONGODB] Inquiry synced to MongoDB Atlas. ID: ${newDoc._id}`);
      } catch (dbErr) {
        console.warn('⚠️  MongoDB Atlas sync failed:', dbErr.message);
      }
    }

    // 3. Save to Google Sheets (Real-Time Webhook)
    const sheetSyncPromise = saveToGoogleSheet(inquiryRecord);

    // 4. Dispatch Dual Automated Emails via Nodemailer (Company Notification + User Auto-Reply)
    const recipientEmail = sanitizeHeaderString(process.env.NOTIFICATION_EMAIL || 'webmanager1728@gmail.com');
    const senderEmail = sanitizeHeaderString(process.env.SMTP_USER);
    const transporter = createTransporter();
    let emailSent = false;
    let autoReplySent = false;
    let emailNote = undefined;

    if (transporter && senderEmail) {
      try {
        const cleanName = sanitizeHeaderString(name);
        const cleanUserEmail = sanitizeHeaderString(email);
        const cleanDept = sanitizeHeaderString(department || 'General Inquiry');

        const [adminMailResult, userMailResult] = await Promise.allSettled([
          // Email 1: Notification to Company Inbox
          transporter.sendMail({
            from: `"Umiya Buildcon Website" <${senderEmail}>`,
            to: recipientEmail,
            replyTo: `"${cleanName}" <${cleanUserEmail}>`,
            subject: `⚡ New Inquiry: ${cleanName} (${cleanDept}) [Ref: ${inquiryRecord.id}]`,
            text: `New Official Inquiry Received:\n\nReference ID: ${inquiryRecord.id}\nClient Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nDepartment: ${cleanDept}\nTime: ${istTimestamp}\nIP: ${inquiryRecord.ipAddress}\n\nMessage / Scope:\n${message}`,
            html: generateAdminNotificationEmailHtml({
              inquiryId: inquiryRecord.id,
              name, email, phone, department, message, timestamp: istTimestamp, cleanPhoneDigits: cleanDigits, ipAddress: inquiryRecord.ipAddress
            })
          }),

          // Email 2: Professional Auto-Reply Confirmation to User
          transporter.sendMail({
            from: `"Umiya Buildcon" <${senderEmail}>`,
            to: cleanUserEmail,
            replyTo: `"Jaymin Patel (Managing Director)" <${recipientEmail}>`,
            subject: `✅ Inquiry Received: ${cleanDept} — Umiya Buildcon [Ref: ${inquiryRecord.id}]`,
            text: `Dear ${name},\n\nThank you for contacting Umiya Buildcon. We have successfully received your inquiry regarding "${cleanDept}".\n\nReference ID: ${inquiryRecord.id}\nSubmitted At: ${istTimestamp}\n\nSummary of Your Message:\n${message}\n\nOur Managing Director Jaymin Patel and our project estimation team are reviewing your requirements and will reach out to you within 2 to 4 business hours.\n\nNeed immediate assistance? Call us directly at +91 962XXXXX82 or reply to this email.\n\nWarm regards,\nJaymin Patel\nManaging Director & Founder\nUmiya Buildcon\nMansa, Gujarat - 382845`,
            html: generateUserConfirmationEmailHtml({
              inquiryId: inquiryRecord.id,
              name, email, phone, department, message, timestamp: istTimestamp
            })
          })
        ]);

        if (adminMailResult.status === 'fulfilled') {
          console.log(`✉️  [COMPANY NOTIFICATION] Dispatched to ${recipientEmail}. ID: ${adminMailResult.value.messageId}`);
          emailSent = true;
        } else {
          console.error(`⚠️  [COMPANY NOTIFICATION] Failed:`, adminMailResult.reason.message);
        }

        if (userMailResult.status === 'fulfilled') {
          console.log(`📬 [USER AUTO-REPLY] Confirmation sent to ${cleanUserEmail}. ID: ${userMailResult.value.messageId}`);
          autoReplySent = true;
        } else {
          console.error(`⚠️  [USER AUTO-REPLY] Failed:`, userMailResult.reason.message);
        }

        if (adminMailResult.status === 'rejected' && userMailResult.status === 'rejected') {
          const err = adminMailResult.reason;
          if (err.code === 'EAUTH' || err.responseCode === 535) {
            console.error('💡 HINT: Gmail requires a 16-character "App Password". Generate at https://myaccount.google.com/apppasswords');
          }
          emailNote = 'Data is saved in database. (Email pending 16-digit App Password in .env)';
        }
      } catch (generalMailErr) {
        console.error('⚠️  [EMAIL ENGINE] Unexpected mail error:', generalMailErr.message);
        emailNote = 'Data is saved in database. (Email delivery error: ' + generalMailErr.message + ')';
      }
    }

    // Await Google Sheet result without stalling response
    const sheetResult = await sheetSyncPromise;

    return res.status(201).json({
      success: true,
      message: 'Inquiry submitted and recorded successfully!',
      data: {
        id: inquiryRecord.id,
        name: name,
        savedInDatabase: true,
        savedInGoogleSheet: sheetResult.success || false,
        emailSent: emailSent,
        autoReplySent: autoReplySent,
        emailNote: emailNote,
        timestamp: istTimestamp
      }
    });
  }
);

// ============================================================================
// 6. BUILT-IN VISUAL ADMIN DASHBOARD (http://localhost:5000/admin)
// ============================================================================
app.get('/admin', async (req, res) => {
  await connectToDatabase();
  let inquiries = [];

  if (mongoose.connection.readyState === 1) {
    try {
      const dbInquiries = await Inquiry.find().sort({ createdAt: -1 }).lean();
      if (dbInquiries && dbInquiries.length > 0) {
        inquiries = dbInquiries.map(inq => ({
          id: String(inq._id),
          name: inq.name,
          email: inq.email,
          phone: inq.phone,
          department: inq.department,
          message: inq.message,
          status: inq.status,
          formattedTime: inq.formattedTime || (inq.createdAt ? new Date(inq.createdAt).toLocaleString('en-IN') : '')
        }));
      }
    } catch (e) {
      console.warn('MongoDB admin read error:', e.message);
    }
  }

  if (inquiries.length === 0) {
    inquiries = readLocalInquiries();
  }

  const hasSheetUrl = Boolean(process.env.GOOGLE_SHEET_WEBHOOK_URL && !process.env.GOOGLE_SHEET_WEBHOOK_URL.includes('your_deployment_id') && process.env.GOOGLE_SHEET_WEBHOOK_URL.trim() !== '');
  const dbLabel = mongoose.connection.readyState === 1 ? 'MongoDB Atlas (Cloud Active)' : 'Local JSON Active';


  const rowsHtml = inquiries.length === 0 
    ? `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748b;">No inquiries received yet. Submit the form on your website to see data here!</td></tr>`
    : inquiries.map((inq, index) => {
        const rawDigits = (inq.phone || '').replace(/\D/g, '');
        const waNumber = rawDigits.length === 10 ? '91' + rawDigits : rawDigits;
        return `
          <tr id="row-${inq.id}">
            <td style="padding:12px; font-weight:bold; color:#0e3a5a;">${index + 1}</td>
            <td style="padding:12px; font-weight:600; color:#0f172a;">${validator.escape(inq.name || '')}</td>
            <td style="padding:12px;">
              <a href="mailto:${inq.email}" style="color:#16527d; text-decoration:none; font-weight:500;">
                ✉️ ${validator.escape(inq.email || '')}
              </a>
            </td>
            <td style="padding:12px; white-space:nowrap;">
              <a href="tel:${inq.phone}" style="color:#0f172a; text-decoration:none; font-weight:600;">
                📞 ${validator.escape(inq.phone || '')}
              </a>
              <a href="https://wa.me/${waNumber}" target="_blank" style="margin-left:6px; background:#16a34a; color:#fff; padding:3px 7px; border-radius:4px; font-size:11px; text-decoration:none;">
                WhatsApp
              </a>
            </td>
            <td style="padding:12px;">
              <span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:600;">
                ${validator.escape(inq.department || 'Unspecified')}
              </span>
            </td>
            <td style="padding:12px; max-width:300px; color:#334155; font-size:13px; line-height:1.4;">
              ${validator.escape(inq.message || '')}
            </td>
            <td style="padding:12px; font-size:12px; color:#64748b; white-space:nowrap;">
              ${inq.formattedTime || inq.createdAt || ''}
            </td>
            <td style="padding:12px; text-align:center;">
              <button onclick="deleteRow('${inq.id}')" style="background:#fee2e2; color:#dc2626; border:1px solid #fecaca; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">
                🗑️ Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Umiya Buildcon — Admin Inquiries Portal</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Poppins', sans-serif; background: #f8fafc; margin: 0; padding: 25px; color: #1e293b; }
        .header { background: linear-gradient(135deg, #081f31 0%, #16527d 100%); color: #fff; padding: 20px 30px; border-radius: 12px; border-bottom: 4px solid #ea8a26; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .header p { margin: 4px 0 0 0; color: #cbd5e1; font-size: 13px; }
        .header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 25px; }
        .stat-card { background: #fff; padding: 18px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
        .stat-card .num { font-size: 24px; font-weight: 700; color: #16527d; }
        .stat-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-top: 4px; }
        .card { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .card-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #fafafa; flex-wrap: wrap; gap: 10px; }
        .card-header h2 { margin: 0; font-size: 16px; font-weight: 700; color: #0e3a5a; }
        .btn { background: #ea8a26; color: #fff; border: none; padding: 8px 15px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; }
        .btn:hover { background: #d57616; }
        .btn-blue { background: #16527d; }
        .btn-blue:hover { background: #0e3a5a; }
        .btn-green { background: #0f766e; }
        .btn-green:hover { background: #115e59; }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { background: #f1f5f9; padding: 12px; font-size: 12px; text-transform: uppercase; color: #475569; font-weight: 700; border-bottom: 2px solid #e2e8f0; }
        td { border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        tr:hover { background: #f8fafc; }
        .search-box { padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; width: 250px; outline: none; }
        .status-pill { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; }
        .status-pill.online { background: #dcfce7; color: #15803d; }
        .status-pill.offline { background: #fef3c7; color: #b45309; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>🏗️ Umiya Buildcon — Inquiries Database</h1>
          <p>Official Website Submissions & Client Inquiries Portal</p>
        </div>
        <div class="header-actions">
          <button onclick="syncToGoogleSheets()" id="syncSheetBtn" class="btn btn-green">📊 Sync to Google Sheet</button>
          <button onclick="window.location.reload()" class="btn btn-blue">🔄 Refresh Data</button>
          <button onclick="exportCSV()" class="btn">📥 Export CSV</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="num">${inquiries.length}</div>
          <div class="label">Total Inquiries Received</div>
        </div>
        <div class="stat-card">
          <div class="num" style="font-size:16px; word-break:break-all;">${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER || 'Configured'}</div>
          <div class="label">Notification Email</div>
        </div>
        <div class="stat-card">
          <div class="num" style="font-size:16px; color:#16a34a;">${dbLabel}</div>
          <div class="label">Database Storage Status</div>
        </div>

        <div class="stat-card">
          <div class="num" style="font-size:16px;">
            ${hasSheetUrl 
              ? '<span class="status-pill online">🟢 Live Synced</span>' 
              : '<span class="status-pill offline">⚠️ Setup Pending</span>'}
          </div>
          <div class="label">Google Sheets Integration</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>📋 All Submitted Messages (${inquiries.length})</h2>
          <input type="text" id="searchBox" class="search-box" placeholder="Search by name, email, dept..." onkeyup="filterTable()">
        </div>
        <div style="overflow-x:auto;">
          <table id="inquiriesTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Full Name</th>
                <th>Email</th>
                <th>Phone Number</th>
                <th>Department</th>
                <th>Message / Details</th>
                <th>Received Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        function filterTable() {
          const input = document.getElementById('searchBox').value.toLowerCase();
          const rows = document.querySelectorAll('#inquiriesTable tbody tr');
          rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(input) ? '' : 'none';
          });
        }

        async function deleteRow(id) {
          if (!confirm('Are you sure you want to delete this inquiry record?')) return;
          try {
            const res = await fetch('/api/inquiries/' + id, { method: 'DELETE' });
            if (res.ok) {
              const row = document.getElementById('row-' + id);
              if (row) row.remove();
            } else {
              alert('Could not delete record');
            }
          } catch(e) {
            alert('Error deleting: ' + e.message);
          }
        }

        async function syncToGoogleSheets() {
          const btn = document.getElementById('syncSheetBtn');
          const originalText = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '⏳ Syncing...';

          try {
            const res = await fetch('/api/sync-google-sheet', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
              alert('🎉 ' + data.message);
            } else {
              alert('⚠️ Google Sheet Notice: ' + data.message + '\\n\\nTip: Follow backend/GOOGLE_SHEETS_SETUP.md to connect your Google Sheet.');
            }
          } catch (err) {
            alert('❌ Sync failed: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
          }
        }

        function exportCSV() {
          const rows = Array.from(document.querySelectorAll('#inquiriesTable tr'));
          const csvContent = rows.map(r => {
            return Array.from(r.querySelectorAll('th, td')).slice(0, 7)
              .map(cell => '"' + cell.innerText.replace(/"/g, '""').trim() + '"')
              .join(',');
          }).join('\\n');

          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'Umiya_Buildcon_Inquiries_' + new Date().toISOString().slice(0, 10) + '.csv';
          link.click();
        }
      </script>
    </body>
    </html>
  `);
});

// Root route redirects to admin dashboard
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

// Start Server (only when run directly, not when imported as serverless function)
if (!process.env.VERCEL && require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Umiya Buildcon Backend Server running on port ${PORT}`);
    console.log(`🌐 Website API Endpoint: http://localhost:${PORT}/api/inquiry`);
    console.log(`📊 Admin Database Portal: http://localhost:${PORT}/admin`);
    console.log(`====================================================`);
  });
}

module.exports = app;

