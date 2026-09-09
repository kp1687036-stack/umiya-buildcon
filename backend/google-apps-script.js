/**
 * ============================================================================
 * UMIYA BUILDCON - GOOGLE APPS SCRIPT FOR GOOGLE SHEETS
 * ============================================================================
 * 
 * Instructions:
 * 1. Open Google Sheets (https://sheets.new)
 * 2. Rename sheet to: "Umiya Buildcon - Website Inquiries"
 * 3. Go to Extensions > Apps Script
 * 4. Delete any existing code in the editor, and paste this ENTIRE code
 * 5. Click "Deploy" > "New deployment"
 * 6. Select Type: "Web app"
 * 7. Description: "Umiya Inquiries Webhook"
 * 8. Execute as: "Me (your email)"
 * 9. Who has access: "Anyone" (IMPORTANT!)
 * 10. Click "Deploy", authorize permissions, and copy the "Web app URL"
 * 11. Paste that URL into your `backend/.env` as `GOOGLE_SHEET_WEBHOOK_URL=...`
 * ============================================================================
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  // Wait for up to 30 seconds for other processes to finish
  lock.tryLock(30000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Auto-setup headers if sheet is brand new or empty
    setupHeadersIfEmpty(sheet);

    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);

    // Handle batch sync (multiple records)
    if (data.action === 'sync_batch' && Array.isArray(data.items)) {
      var rows = [];
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        rows.push(formatInquiryRow(item));
      }
      
      if (rows.length > 0) {
        var startRow = sheet.getLastRow() + 1;
        var numRows = rows.length;
        var numCols = rows[0].length;
        sheet.getRange(startRow, 1, numRows, numCols).setValues(rows);
        formatDataRows(sheet, startRow, numRows);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: rows.length + ' inquiries synced successfully.',
        count: rows.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Handle single record insertion
    var rowData = formatInquiryRow(data);
    sheet.appendRow(rowData);
    var newRowNum = sheet.getLastRow();
    formatDataRows(sheet, newRowNum, 1);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Inquiry saved to Google Sheet successfully.',
      row: newRowNum
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'OK',
    message: 'Umiya Buildcon Google Sheets Webhook is active and listening.'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Format inquiry object into spreadsheet row array
 */
function formatInquiryRow(item) {
  var timestamp = item.formattedTime || item.createdAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  var name = item.name || '';
  var email = item.email || '';
  var phone = item.phone || '';
  var department = item.department || 'General / Unspecified';
  var message = item.message || '';
  var ipAddress = item.ipAddress || 'Unknown';
  var status = item.status || 'New';
  var id = item.id || item._id || '';

  return [
    timestamp,
    name,
    email,
    phone,
    department,
    message,
    ipAddress,
    status,
    id
  ];
}

/**
 * Auto-initialize beautiful headers if sheet is empty
 */
function setupHeadersIfEmpty(sheet) {
  if (sheet.getLastRow() === 0) {
    var headers = [
      'Received Time (IST)',
      'Full Name',
      'Email Address',
      'Phone Number',
      'Department / Org',
      'Message / Scope',
      'IP Address',
      'Status',
      'Inquiry ID'
    ];

    sheet.appendRow(headers);

    // Style Header Row
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#081f31'); // Navy Blue
    headerRange.setFontColor('#ffffff'); // White
    headerRange.setFontWeight('bold');
    headerRange.setFontSize(11);
    headerRange.setHorizontalAlignment('center');
    headerRange.setVerticalAlignment('middle');
    sheet.setRowHeight(1, 38);

    // Freeze header row
    sheet.setFrozenRows(1);
  }
}

/**
 * Apply styling and alternating row background
 */
function formatDataRows(sheet, startRow, numRows) {
  var range = sheet.getRange(startRow, 1, numRows, 9);
  range.setFontSize(10);
  range.setVerticalAlignment('middle');
  range.setWrap(true);

  // Set borders
  range.setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  for (var r = startRow; r < startRow + numRows; r++) {
    sheet.setRowHeight(r, 32);
    if (r % 2 === 0) {
      sheet.getRange(r, 1, 1, 9).setBackground('#f8fafc');
    } else {
      sheet.getRange(r, 1, 1, 9).setBackground('#ffffff');
    }
  }

  // Alignments
  sheet.getRange(startRow, 1, numRows, 1).setHorizontalAlignment('center'); // Timestamp
  sheet.getRange(startRow, 4, numRows, 1).setHorizontalAlignment('center'); // Phone
  sheet.getRange(startRow, 7, numRows, 1).setHorizontalAlignment('center'); // IP
  sheet.getRange(startRow, 8, numRows, 1).setHorizontalAlignment('center'); // Status
  sheet.getRange(startRow, 9, numRows, 1).setHorizontalAlignment('center'); // ID

  // Auto resize columns for clarity
  for (var c = 1; c <= 9; c++) {
    sheet.autoResizeColumn(c);
  }
}
