# 🏗️ Umiya Buildcon — Backend Server API

A secure, production-ready Node.js & Express backend API for the **Umiya Buildcon** official inquiry and tender contact form.

---

## ⚡ Features
- **Database**: Connects to **MongoDB Atlas (Free M0 Cluster)** with Mongoose schema, validation, and auto-timestamps.
- **Email Notifications**: Automatically sends styled HTML emails to `webmanager1728@gmail.com` using **Nodemailer** with direct WhatsApp, Phone, and Email reply buttons.
- **Security & Protection**:
  - **Helmet**: Secures HTTP headers.
  - **Rate Limiter**: Limits submissions to 5 per 15 minutes per IP to block spam bots.
  - **Express-Validator & Sanitization**: Validates inputs and escapes HTML to eliminate XSS.
  - **CORS**: Flexible configuration for local dev and live frontend domain.
  - **Payload Size Limits**: Blocks large payloads from DoS attacks.

---

## 🚀 Quick Setup Guide

### 1. Install Dependencies
Navigate into the `backend` folder and install packages:
```bash
cd backend
npm install
```

---

### 2. Configure Environment Variables (.env)
Create a `.env` file in the `backend` folder (copy from `.env.example`):
```bash
cp .env.example .env
```

Fill in the `.env` values:
```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=*
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/umiya_buildcon?retryWrites=true&w=majority
NOTIFICATION_EMAIL=webmanager1728@gmail.com
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=your-16-character-app-password
```

---

### 3. How to Get a Free MongoDB Atlas Connection String
1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas) and sign up for a free account.
2. Click **"Create a Deployment"** and select the **M0 (Free)** tier.
3. Under **Security Quickstart**:
   - Create a Database User (e.g. Username: `umiya_admin`, Password: `yourSecurePassword`).
   - Under **IP Access List**, add `0.0.0.0/0` (Allow access from anywhere).
4. Go to **Database** -> Click **Connect** -> Choose **"Drivers"** (Node.js).
5. Copy the connection string and paste it into `MONGODB_URI` in `.env`:
   ```
   mongodb+srv://umiya_admin:<password>@cluster0.abcde.mongodb.net/umiya_buildcon?retryWrites=true&w=majority
   ```

---

### 4. How to Generate a Google Gmail App Password
1. Go to your [Google Account Security Settings](https://myaccount.google.com/security).
2. Enable **2-Step Verification** if not already enabled.
3. Search for **"App passwords"** in the top search bar (or visit https://myaccount.google.com/apppasswords).
4. Name it `Umiya Buildcon Website` and click **Create**.
5. Copy the **16-letter password** (e.g. `abcd efgh ijkl mnop`).
6. Set `SMTP_USER=yourgmail@gmail.com` and `SMTP_PASS=abcdefghijklmnop` in `.env`.

---

### 5. Run the Server Locally
```bash
# Production mode:
npm start

# Development mode (with auto-reload):
npm run dev
```
The server will run at: `http://localhost:5000`

---

## 🌐 Deploy to Render (100% Free Hosting)

1. Push your repository to **GitHub**.
2. Sign in to [Render.com](https://render.com) and click **"New +" -> "Web Service"**.
3. Connect your GitHub repository.
4. Set the following build settings:
   - **Root Directory**: `backend` (if in a subfolder) or leave blank if in repository root.
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan Type**: `Free`
5. Click **"Environment Variables"** and add all variables from `.env`:
   - `PORT` = `5000`
   - `NODE_ENV` = `production`
   - `FRONTEND_URL` = `*` (or your live frontend domain)
   - `MONGODB_URI` = `your-mongodb-atlas-uri`
   - `NOTIFICATION_EMAIL` = `webmanager1728@gmail.com`
   - `SMTP_USER` = `your-gmail@gmail.com`
   - `SMTP_PASS` = `your-16-character-app-password`
6. Click **Deploy Web Service**.
7. Copy your live Render URL (e.g., `https://umiya-buildcon-api.onrender.com`) and update your frontend JavaScript `fetch()` URL!
