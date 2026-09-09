/**
 * Email Diagnostic Tool for Umiya Buildcon
 * Run from any folder:
 * node test-email.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
require('dotenv').config(); // fallback
const nodemailer = require('nodemailer');

console.log('====================================================');
console.log('🔍 UMIYA BUILDCON — NODEMAILER DIAGNOSTIC TEST');
console.log('====================================================');
console.log(`📧 Sender Account:    ${process.env.SMTP_USER || '(Not set in backend/.env)'}`);
console.log(`🔑 Password length:   ${process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0} characters`);
console.log(`📬 Destination Inbox: ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER || '(Not set)'}`);
console.log('====================================================');

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('❌ ERROR: SMTP_USER or SMTP_PASS is missing in backend/.env file.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function runTest() {
  try {
    console.log('⏳ 1. Testing Google SMTP Connection...');
    await transporter.verify();
    console.log('✅ 1. Google SMTP Connected & Authenticated Successfully!');

    console.log('⏳ 2. Sending Test Notification Email...');
    const info = await transporter.sendMail({
      from: `"Umiya Buildcon System" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject: '✅ Umiya Buildcon: Email System is Working!',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 25px; border: 2px solid #ea8a26; border-radius: 10px; max-width: 550px;">
          <h2 style="color: #16527d; margin-top: 0;">Umiya Buildcon — Email Test Succeeded!</h2>
          <p style="color: #334155; line-height: 1.6;">
            Your Nodemailer email configuration is 100% active and working.
          </p>
          <div style="background-color: #fef7ee; border-left: 4px solid #ea8a26; padding: 12px; margin: 15px 0;">
            <strong style="color: #ea8a26;">Status:</strong> Ready to receive client website inquiries!
          </div>
          <p style="font-size: 12px; color: #64748b;">Dispatched at: ${new Date().toLocaleString('en-IN')}</p>
        </div>
      `
    });

    console.log('🎉 2. Test Email Sent Successfully! Message ID:', info.messageId);
    console.log(`📬 Check your inbox at: ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER}`);
  } catch (error) {
    console.error('\n❌ EMAIL TEST FAILED:');
    console.error('Error Code:', error.code || 'UNKNOWN');
    console.error('Error Message:', error.message);
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.log('\n======================================================');
      console.log('⚠️  REASON: GOOGLE BLOCKED REGULAR LOGIN PASSWORD');
      console.log('======================================================');
      console.log('Gmail requires a 16-character "App Password".');
      console.log('Regular account passwords like "kp1728000" are blocked by Google.');
      console.log('\n👉 HOW TO FIX IN 1 MINUTE:');
      console.log('1. Go to: https://myaccount.google.com/apppasswords');
      console.log('2. Log in with: webmanager1728@gmail.com');
      console.log('3. Under App name, type "Umiya" and click Create.');
      console.log('4. Copy the 16-character password (e.g. abcd efgh ijkl mnop).');
      console.log('5. Paste it in backend/.env for SMTP_PASS.');
      console.log('======================================================\n');
    }
  }
}

runTest();
