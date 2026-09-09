# 🚀 Vercel Free Full-Stack Deployment Guide

This guide walks you through deploying both the **Frontend Website** and **Backend Serverless API** together on **Vercel** for 100% free hosting.

---

## ⚡ Architecture Overview

- **Frontend (`index.html`)**: Hosted globally on Vercel's Edge CDN.
- **Backend (`/api/*` & `/admin`)**: Hosted as Serverless Functions (`api/index.js`).
- **Google Sheets & Nodemailer Email**: Triggered in real-time on every form submission.
- **Single Domain**: Both frontend and backend live under one free URL (e.g. `https://umiya-buildcon.vercel.app`), ensuring **zero CORS issues**.

---

## 🛠️ Step-by-Step Deployment Instructions

### Method 1: Deploy via GitHub (Recommended & Easiest)

#### 1. Push your code to GitHub
If you haven't pushed your code to GitHub yet, run these commands in your project folder:

```bash
git init
git add .
git commit -m "Umiya Buildcon Full-Stack Vercel Ready"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

#### 2. Import Project on Vercel
1. Go to [https://vercel.com](https://vercel.com) and log in (with GitHub).
2. Click **Add New...** > **Project**.
3. Select your GitHub repository (`umiya-buildcon`) and click **Import**.

#### 3. Add Environment Variables on Vercel
In the **Environment Variables** section on Vercel, add the following variables:

| Variable Name | Value / Example | Description |
|---|---|---|
| `GOOGLE_SHEET_WEBHOOK_URL` | `https://script.google.com/macros/s/.../exec` | Google Sheets Webhook URL |
| `SMTP_USER` | `webmanager1728@gmail.com` | Your Gmail address |
| `SMTP_PASS` | `16-digit Google App Password` | Gmail App Password |
| `NOTIFICATION_EMAIL` | `webmanager1728@gmail.com` | Email where lead alerts are sent |
| `MONGODB_URI` | *(Optional)* `mongodb+srv://...` | MongoDB Atlas database URI |

#### 4. Click "Deploy"
Click the **Deploy** button. In ~30 seconds, Vercel will give you a live production URL (e.g. `https://umiya-buildcon.vercel.app`)!

---

### Method 2: Deploy via Vercel CLI

You can also deploy directly from your terminal:

```bash
npx vercel
```

1. It will ask: `Set up and deploy?` → Type `y` and press Enter.
2. Follow the on-screen prompts (accept default settings).
3. To deploy to production, run:
   ```bash
   npx vercel --prod
   ```
4. Set your environment variables in your Vercel project dashboard at [https://vercel.com/dashboard](https://vercel.com/dashboard).

---

## 🔍 Verification After Deployment

1. **Visit your live URL**: `https://your-project.vercel.app`
2. **Test Health Endpoint**: `https://your-project.vercel.app/api/health`
3. **Open Admin Dashboard**: `https://your-project.vercel.app/admin`
4. **Submit Contact Form**: Send a test inquiry and verify:
   - Success alert is shown on screen.
   - Row appears in your **Google Sheet**.
   - Email alert arrives in your **Gmail inbox**.
