/**
 * Dual Email Diagnostic Tool for Umiya Buildcon
 * Tests both:
 * 1. Company Support Notification Email
 * 2. User Confirmation Auto-Reply Email
 * Run with: node backend/test-email.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback
const nodemailer = require('nodemailer');

console.log('----------------------------------------------------');
console.log('🔍 Testing Dual Email Automation (Notification + Auto-Reply)...');
console.log(`📧 Sender Email:   ${process.env.SMTP_USER}`);
console.log(`🔑 Password length: ${process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0} characters`);
console.log(`📬 Target Inbox:   ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER}`);
console.log('----------------------------------------------------');

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('❌ ERROR: SMTP_USER or SMTP_PASS is missing in your .env file.');
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
    console.log('⏳ 1. Verifying SMTP Connection with Google...');
    await transporter.verify();
    console.log('✅ 1. SMTP Credentials Verified Successfully!\n');

    const testInquiryId = 'INQ-TEST-' + Math.floor(1000 + Math.random() * 9000);
    const testTimestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    console.log('⏳ 2. Sending Company Notification Email (Action 1)...');
    const companyInfo = await transporter.sendMail({
      from: `"Umiya Buildcon Website" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject: `🚨 [TEST] New Website Inquiry: Rajesh Sharma (Military Engineer Services) [Ref: ${testInquiryId}]`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 25px; border: 2px solid #16527d; border-radius: 10px; background: #ffffff;">
          <h2 style="color: #081f31; margin-top: 0; border-bottom: 3px solid #ea8a26; padding-bottom: 8px;">🚨 New Website Inquiry (Company Copy)</h2>
          <p><strong>Ref ID:</strong> ${testInquiryId}</p>
          <p><strong>Client:</strong> Rajesh Sharma</p>
          <p><strong>Email:</strong> client@example.com</p>
          <p><strong>Phone:</strong> +91 98765 43210</p>
          <p><strong>Department:</strong> Military Engineer Services (MES)</p>
          <p><strong>Message:</strong> Need technical feasibility assessment for runway resurfacing and drainage culverts.</p>
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            Dispatched at: ${testTimestamp}
          </div>
        </div>
      `
    });
    console.log(`🎉 Company Notification Sent! (Message ID: ${companyInfo.messageId})\n`);

    console.log('⏳ 3. Sending User Auto-Reply Confirmation Email (Action 2)...');
    const userInfo = await transporter.sendMail({
      from: `"Umiya Buildcon" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER, // Sends to tester inbox for verification
      subject: `✅ We received your inquiry regarding Military Engineer Services — Umiya Buildcon [Ref: ${testInquiryId}]`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 25px; border: 2px solid #ea8a26; border-radius: 10px; background: #ffffff;">
          <h2 style="color: #16527d; margin-top: 0; border-bottom: 3px solid #ea8a26; padding-bottom: 8px;">✅ Inquiry Received — Umiya Buildcon</h2>
          <p>Dear Rajesh Sharma,</p>
          <p>Thank you for contacting <strong>Umiya Buildcon</strong>. We have received your inquiry regarding <strong>Military Engineer Services (MES)</strong>.</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #16527d; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <p style="margin: 0 0 5px 0;"><strong>Reference ID:</strong> ${testInquiryId}</p>
            <p style="margin: 0 0 5px 0;"><strong>Submitted Scope:</strong> Runway resurfacing & drainage culverts</p>
            <p style="margin: 0;"><strong>Submitted At:</strong> ${testTimestamp}</p>
          </div>
          <p>Managing Director <strong>Jaymin Patel</strong> and our estimation desk will contact you within 2 to 4 business hours.</p>
          <p style="margin-top: 20px; font-size: 13px; color: #64748b;">
            Office: +91 962XXXXX82 • 7, Umiya Complex, Kalol Road, Mansa, Gujarat
          </p>
        </div>
      `
    });
    console.log(`🎉 User Auto-Reply Confirmation Sent! (Message ID: ${userInfo.messageId})\n`);

    console.log('======================================================');
    console.log('🌟 DUAL EMAIL AUTOMATION TEST COMPLETE & VERIFIED!');
    console.log(`📬 Check inbox: ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER}`);
    console.log('======================================================');
  } catch (error) {
    console.error('\n❌ EMAIL TEST FAILED:');
    console.error('Error Message:', error.message);
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.log('\n======================================================');
      console.log('⚠️  REASON: GOOGLE REJECTED REGULAR ACCOUNT PASSWORD');
      console.log('======================================================');
      console.log('Google requires a 16-character "App Password".');
      console.log('1. Go to: https://myaccount.google.com/apppasswords');
      console.log('2. Log in with your Gmail account.');
      console.log('3. Under App name, type "Umiya" and click Create.');
      console.log('4. Copy the 16-character password into backend/.env for SMTP_PASS.');
      console.log('======================================================\n');
    }
  }
}

runTest();

