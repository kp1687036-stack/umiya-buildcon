/**
 * ============================================================================
 * UMIYA BUILDCON - GOOGLE SHEETS WEBHOOK DIAGNOSTIC TOOL
 * ============================================================================
 * Run this script to test if your Google Sheets Webhook is active and working:
 * node test-google-sheets.js
 * ============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // fallback

const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;

console.log('====================================================');
console.log('🔍 Testing Google Sheets Webhook Connection...');
console.log(`🌐 Webhook URL: ${webhookUrl ? webhookUrl.substring(0, 45) + '...' : '❌ NOT SET'}`);
console.log('====================================================');

if (!webhookUrl || webhookUrl.includes('your_google_script_url') || webhookUrl.trim() === '') {
  console.log('\n❌ ERROR: GOOGLE_SHEET_WEBHOOK_URL is not set in backend/.env');
  console.log('\n👉 HOW TO SET UP IN 1 MINUTE:');
  console.log('1. Open: https://sheets.new');
  console.log('2. Click: Extensions > Apps Script');
  console.log('3. Paste the code from backend/google-apps-script.js');
  console.log('4. Click Deploy > New deployment > Web app > Access: "Anyone" > Deploy');
  console.log('5. Copy the Web App URL and paste it in backend/.env as:');
  console.log('   GOOGLE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/.../exec');
  console.log('6. Re-run this test: node test-google-sheets.js\n');
  process.exit(1);
}

async function runTest() {
  const istTimestamp = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium'
  });

  const testPayload = {
    id: 'test_' + Date.now(),
    name: 'Umiya System Diagnostic (Test)',
    email: 'test@umiyabuildcon.com',
    phone: '+91 962XXXXX82',
    department: 'Civil Infrastructure Test',
    message: 'This is an automated test inquiry verifying that Google Sheets real-time integration is connected and functioning properly.',
    ipAddress: '127.0.0.1 (Local Diagnostic)',
    status: 'Verified',
    formattedTime: istTimestamp
  };

  try {
    console.log('⏳ Sending test inquiry to Google Sheets...');
    
    // Google Apps Script redirects (302) on POST, so follow redirects
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain prevents CORS preflight issues with Apps Script
      body: JSON.stringify(testPayload),
      redirect: 'follow'
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { raw: responseText };
    }

    if (response.ok && (result.success !== false)) {
      console.log('🎉 SUCCESS: Test row has been appended to your Google Sheet!');
      console.log('📋 Server Response:', result);
      console.log('\n👉 Open your Google Sheet now to view the new styled row.');
    } else {
      console.error('⚠️  Google Sheets responded with an issue:', result);
    }
  } catch (err) {
    console.error('\n❌ FAILED TO CONNECT TO GOOGLE SHEETS:');
    console.error('Error details:', err.message);
    console.log('\n💡 TIPS:');
    console.log('- Check your internet connection.');
    console.log('- Make sure when deploying in Apps Script you selected: Who has access -> "Anyone".');
  }
}

runTest();
