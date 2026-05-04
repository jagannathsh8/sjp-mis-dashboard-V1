/**
 * doGet — Returns ALL sheet tabs as JSON.
 * Each tab is a month. Response format:
 * { status:"success", tabs:[ {name:"April-2026", data:[...rows...]}, ... ] }
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var tabs = [];

  for (var t = 0; t < sheets.length; t++) {
    var sheet = sheets[t];
    var name = sheet.getName().trim();
    // Skip config/meta tabs
    if (name.toLowerCase() === 'config' || name.toLowerCase() === 'template') continue;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;

    var headers = data[0].map(function(h) { return String(h || '').trim(); });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        var key = headers[j];
        if (!key) continue;               // skip completely empty header columns
        var val = row[j];
        // Convert null / undefined / empty string consistently
        if (val === null || val === undefined) val = '';
        obj[key] = val;
      }
      rows.push(obj);
    }
    tabs.push({ name: name, data: rows });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', tabs: tabs }))
    .setMimeType(ContentService.MimeType.JSON);
}