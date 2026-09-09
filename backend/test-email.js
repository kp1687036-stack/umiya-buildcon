/**
 * Quick Email Diagnostic Tool for Umiya Buildcon
 * Run this to test if your Gmail credentials work:
 * node test-email.js
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('----------------------------------------------------');
console.log('🔍 Testing Nodemailer Gmail Connection...');
console.log(`📧 Sender Email:   ${process.env.SMTP_USER}`);
console.log(`🔑 Password length: ${process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0} characters`);
console.log(`📬 Target Email:   ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER}`);
console.log('----------------------------------------------------');

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('❌ ERROR: SMTP_USER or SMTP_PASS is missing in .env file.');
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
    console.log('⏳ 1. Verifying SMTP Credentials with Google...');
    await transporter.verify();
    console.log('✅ 1. SMTP Credentials Verified Successfully!');

    console.log('⏳ 2. Sending Test Email...');
    const info = await transporter.sendMail({
      from: `"Umiya Buildcon Test" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject: '✅ Test Notification: Email Integration Working!',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #ea8a26; border-radius: 8px;">
          <h2 style="color: #16527d; margin-top: 0;">Umiya Buildcon - Email Test Successful</h2>
          <p>Congratulations! Your Nodemailer setup is working perfectly.</p>
          <p>When clients submit the <strong>Send Official Inquiry</strong> form on your website, you will receive styled notifications just like this.</p>
          <hr style="border: 1px solid #f1f5f9; margin: 15px 0;">
          <small style="color: #64748b;">Test Sent at: ${new Date().toLocaleString('en-IN')}</small>
        </div>
      `
    });

    console.log('🎉 2. Test Email Sent Successfully! Message ID:', info.messageId);
    console.log(`📬 Please check the inbox of: ${process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER}`);
  } catch (error) {
    console.error('\n❌ EMAIL TEST FAILED:');
    console.error('Error Message:', error.message);
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.log('\n======================================================');
      console.log('⚠️  REASON: GOOGLE REJECTED REGULAR ACCOUNT PASSWORD');
      console.log('======================================================');
      console.log('Google does not accept your personal Gmail login password.');
      console.log('You MUST use a 16-character "App Password".');
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
