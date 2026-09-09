# 📊 Google Sheets Real-Time Sync Setup Guide

This guide explains how to link your Google Sheet with the **Umiya Buildcon** website so that every contact form submission automatically appends a new row in your spreadsheet in real time.

---

## ⚡ Quick 1-Minute Setup

### Step 1: Create a New Google Sheet
1. Open [https://sheets.new](https://sheets.new) in your browser.
2. Name the spreadsheet: **`Umiya Buildcon - Website Inquiries`**.

---

### Step 2: Add Google Apps Script
1. In the Google Sheet top menu, click **Extensions** > **Apps Script**.
2. A code editor tab will open. Delete any code currently in the file `Code.gs`.
3. Open [`backend/google-apps-script.js`](./google-apps-script.js) in this project, copy the entire code, and paste it into the editor.
4. Click the **Save** icon (💾) or press `Ctrl + S`.

---

### Step 3: Deploy as Web App
1. In the top right corner of Apps Script, click the blue **Deploy** button > **New deployment**.
2. Click the **gear icon** (⚙️) next to "Select type" and choose **Web app**.
3. Fill in the deployment details:
   - **Description**: `Umiya Buildcon Inquiries Webhook`
   - **Execute as**: `Me (your email)`
   - **Who has access**: **`Anyone`** *(⚠️ Critical: Select "Anyone" so the server can send data)*
4. Click **Deploy**.
5. Click **Authorize access** and choose your Google Account.
   - *(If Google shows "Google hasn't verified this app", click **Advanced** > **Go to Untitled project (unsafe)** > **Allow**).*
6. Copy the **Web app URL** (it looks like `https://script.google.com/macros/s/AKfycb.../exec`).

---

### Step 4: Add URL to `backend/.env`
Open [`backend/.env`](./.env) and set your copied URL:

```env
GOOGLE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/AKfycb.../exec
```

---

## 🧪 Step 5: Test the Integration

Run the test script from the `backend/` folder:

```bash
node test-google-sheets.js
```

You will see:
```text
✅ Google Sheets Webhook Verified!
🎉 Test Row Appended to your Google Sheet!
```

Open your Google Sheet, and you will see the formatted headers and a test entry!

---

## 🌟 Features Included

- **Automatic Headers**: Generates professional Navy & Orange styled headers automatically.
- **Real-Time Row Insertion**: Captures Full Name, Email, Phone, Department, Message, IP Address, Status, and Timestamp immediately when a user clicks submit.
- **1-Click Sync from Admin Portal**: Go to `http://localhost:5000/admin` and click **"📊 Sync All to Google Sheets"** to export all existing inquiries at any time.
- **Fail-Safe & Non-Blocking**: If Google Sheets is temporarily unreachable, the inquiry is still safely stored in local JSON database, MongoDB Atlas, and sent via Email.
