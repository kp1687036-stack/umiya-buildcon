# Umiya Buildcon — Official Website & Infrastructure Portal

> **Government Approved Civil & Defense Infrastructure Contractors**  
> Specializing in Military Engineer Services (MES), Indian Air Force Bases, Indian Navy Coastal Infrastructure, Roads & Highway Networks, and Institutional Civil Structures.

---

## 📁 Project Directory Structure

```text
Project Umiya Buildcon/
├── assets/
│   └── images/
│       └── logo.jpeg               # High-resolution official company logo
├── backend/
│   ├── data/
│   │   └── inquiries.json          # Persistent local database for inquiries
│   ├── .env                        # Private environment variables (Credentials, DB, Email, Sheets)
│   ├── .env.example                # Example environment template
│   ├── .gitignore                  # Backend gitignore
│   ├── google-apps-script.js       # Google Apps Script code for Google Sheets sync
│   ├── GOOGLE_SHEETS_SETUP.md      # Google Sheets integration setup guide
│   ├── package.json                # Backend dependency declarations
│   ├── package-lock.json
│   ├── README.md                   # Backend & API documentation
│   ├── server.js                   # Node.js / Express API & Admin Portal engine
│   ├── test-email.js               # Diagnostic test script for Gmail SMTP dual emails
│   └── test-google-sheets.js       # Diagnostic test script for Google Sheets API
├── api/
│   └── index.js                    # Vercel Serverless Function entry point
├── index.html                      # Complete Frontend UI with Security Gate & Pure JS
├── logo.jpeg                       # Root Favicon & Preload Asset
├── vercel.json                     # Vercel production routing configuration
├── VERCEL_DEPLOYMENT_GUIDE.md      # 1-Click Vercel Deployment Instructions
├── package.json                    # Root package configuration & npm scripts
└── README.md                       # Project architecture & documentation
```

---

## 🚀 Getting Started

### 1. Run the Frontend Website
Open `index.html` directly in any web browser, or serve with VS Code Live Server.

### 2. Run the Backend API Server
```bash
# Start backend server on http://localhost:5000
npm start

# Or run with nodemon in development
npm run dev
```

### 3. Run Automated System Tests
```bash
# Test Gmail SMTP dual-email delivery (Company alert + User auto-reply)
npm run test:email

# Test Google Sheets automated real-time syncing
npm run test:sheets
```

---

## 🛡️ Key Features

1. **Compulsory Security Login Gateway**:
   - Access to website content is protected behind an Obsidian Black & Golden Amber security portal.
   - Supports Google 1-Click Sign-In (GIS), 1-Click Executive Access (Jaymin Patel / Contractor), and Direct Verification.
   - Persistent session storage in `localStorage` with instant re-lock from navbar or sidebar.

2. **Inquiry Pipeline & Auto-Sync**:
   - Triple-redundant storage: **MongoDB Atlas** + **Local JSON Database** + **Google Sheets**.
   - Automated dual-email notifications with defense-grade responsive HTML templates.

3. **Production Ready**:
   - Configured for 1-Click deployment on **Vercel** (`vercel.json` + `api/index.js`).
