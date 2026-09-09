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

if (MONGODB_URI && !MONGODB_URI.includes('yourpassword') && !MONGODB_URI.includes('cluster0.abcde.mongodb.net')) {
  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected successfully to MongoDB Atlas Database.'))
    .catch((err) => console.error('❌ MongoDB Atlas connection error:', err.message));
} else {
  console.log('ℹ️  MongoDB Atlas: Local database active in "backend/data/inquiries.json". Add your MongoDB URI in .env to sync to cloud.');
}

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

const Inquiry = mongoose.model('Inquiry', InquirySchema);

// ============================================================================
// 4. NODEMAILER EMAIL NOTIFICATION CONFIGURATION
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

const generateEmailHtml = ({ name, email, phone, department, message, timestamp, cleanPhoneDigits }) => {
  const whatsappUrl = `https://wa.me/${cleanPhoneDigits}`;
  const mailtoUrl = `mailto:${email}?subject=Re:%20Official%20Inquiry%20-%20Umiya%20Buildcon`;
  const telUrl = `tel:${phone.replace(/\s+/g, '')}`;

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0; padding:0; background-color:#f4f6f8; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#334155;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f6f8; padding:30px 10px;">
      <tr>
        <td align="center">
          <table border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08); border:1px solid #e2e8f0;">
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
                  🚨 Managing Director Alert: A new inquiry has been submitted via the website contact form.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:15px 30px 20px 30px;">
                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 0; width:38%; font-size:13px; font-weight:600; color:#64748b;">Full Name:</td>
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
                  <tr>
                    <td style="padding:10px 0; font-size:13px; font-weight:600; color:#64748b;">Submitted At:</td>
                    <td style="padding:10px 0; font-size:13px; color:#64748b;">${timestamp}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 25px 30px;">
                <h3 style="font-size:14px; color:#0e3a5a; text-transform:uppercase; margin:0 0 10px 0; border-bottom:2px solid #f1f5f9; padding-bottom:6px;">💬 Message / Tender Scope:</h3>
                <div style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; font-size:14px; color:#1e293b; white-space:pre-wrap;">${validator.escape(message)}</div>
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
                Umiya Buildcon • 7, Umiya Complex, Kalol Road, Mansa - 382845, Gujarat • +91 87359 93873
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

// DELETE /api/inquiries/:id - Delete an inquiry
app.delete('/api/inquiries/:id', async (req, res) => {
  const { id } = req.params;
  try {
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

    // 4. Dispatch Email Notification via Nodemailer
    const recipientEmail = process.env.NOTIFICATION_EMAIL || 'webmanager1728@gmail.com';
    const transporter = createTransporter();
    let emailSent = false;
    let emailNote = undefined;

    if (transporter) {
      try {
        const mailOptions = {
          from: `"Umiya Buildcon Website" <${process.env.SMTP_USER}>`,
          to: recipientEmail,
          replyTo: `"${name}" <${email}>`,
          subject: `⚡ New Inquiry: ${name} (${department || 'Website Lead'})`,
          text: `New Inquiry Received:\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nDepartment: ${department || 'N/A'}\nTime: ${istTimestamp}\n\nMessage:\n${message}`,
          html: generateEmailHtml({
            name, email, phone, department, message, timestamp: istTimestamp, cleanPhoneDigits: cleanDigits
          })
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✉️  [EMAIL] Dispatched to ${recipientEmail}. ID: ${info.messageId}`);
        emailSent = true;
      } catch (mailErr) {
        console.error(`⚠️  [EMAIL] Delivery error (${mailErr.code || 'FAIL'}):`, mailErr.message);
        if (mailErr.code === 'EAUTH' || mailErr.responseCode === 535) {
          console.error('💡 HINT: Gmail requires a 16-character "App Password". Generate at https://myaccount.google.com/apppasswords');
        }
        emailNote = 'Data is saved in database. (Email pending 16-digit App Password in .env)';
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
        emailNote: emailNote,
        timestamp: istTimestamp
      }
    });
  }
);

// ============================================================================
// 6. BUILT-IN VISUAL ADMIN DASHBOARD (http://localhost:5000/admin)
// ============================================================================
app.get('/admin', (req, res) => {
  const inquiries = readLocalInquiries();
  const hasSheetUrl = Boolean(process.env.GOOGLE_SHEET_WEBHOOK_URL && !process.env.GOOGLE_SHEET_WEBHOOK_URL.includes('your_deployment_id') && process.env.GOOGLE_SHEET_WEBHOOK_URL.trim() !== '');

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
          <div class="num" style="color:#16a34a;">Active</div>
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

