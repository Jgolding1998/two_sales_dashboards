const express = require('express');
const axios = require('axios');

/*
 * This server exposes two endpoints that proxy calls to Infor CSI's
 * IDORequestService. It aggregates sales by day using two different
 * definitions of the sale date. Both endpoints require a valid
 * Infor Mongoose security token and base URL, which can be set in
 * environment variables or directly in this file. The token is never
 * exposed to the client – all calls happen on the server side.
 */

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration – you can override these via environment variables if needed
// Override defaults with the known base URL and token from the user. These values will
// be used if the corresponding environment variables are not set. You can still
// override them via environment variables when deploying to another environment.
const BASE_URL = process.env.INFOR_BASE_URL || 'https://csi10g.erpsl.inforcloudsuite.com/IDORequestService/ido';
// The following token was supplied by the user. It provides long‑lived
// authentication to the CSI IDORequestService. Because this token does not expire
// until the user's password changes, treat it like a secret and do not expose it
// to the client. If you have your own token or wish to override it, set
// INFOR_TOKEN or TOKEN in the environment.
const MONGO_TOKEN = process.env.INFOR_TOKEN || process.env.TOKEN ||
  'b/XdI6IQzCviZOGJ0E+002DoKUFOPmVDkwpQDbQjm3w/qkdxDUzmqvSYEZDCmJGWpA23OTlhFpxRHFz3WOsvay8V58XdIp/UIsr5TpCdMwvoO+jzjloJpqRoP6SsKySXobCRJO6SY1QkbdGfehyJtGiu2K7hVnKhNT29czLENjA4ecu2etCY0X2TiDP1No0nnxDy0iApzJ95qGV31wMxsjaTqlFi+chr+wizG0ygEQ6IpviNaNpDOj13PWvSeuWroNaa0Uw1PnbmSGoT8DFhUGFBb5fzd4WKeHlBz0doFkr2oEumIAY5u/LN3XqTUgphv33X62Ruds7XOMLiz0rjezoiMXMbDkjK/aNHirvjV0Xc5XmSS6urfiEDfp0f+WBXlGN4qt3YFkFKflKj16ZEY7W4lf12LgK9ivN7LRxbqxTIS6K3Gz9AhQ2N6+iCTE/WhbFMTvrKRzBISjj6E+C/d/d++PL7a4uQr/AQZsp2tJL5hXmK5nvifF8HM9Wq9oDHcQ1Y6RAOm0RD/3/OymbCSH4A0o1HckqXWSdgnYlcqjg=';
// The config name to pass with each request. This may vary by tenant.
const CONFIG_NAME = process.env.INFOR_CONFIG || 'GVNDYXUFKHB5VMB6_PRD_CTI';

// Helper to fetch collections from the IDO API. This function accepts
// the collection name, a list of properties to fetch and an optional filter.
async function loadCollection(idoName, properties = [], filter = '') {
  const props = properties.join(',');
  const url = `${BASE_URL}/load/${encodeURIComponent(idoName)}`;
  const params = {};
  if (props) params.properties = props;
  if (filter) params.filter = filter;
  params.recordcap = 0;
  const headers = {
    'Authorization': MONGO_TOKEN,
    'Accept': 'application/json',
    'X-Infor-MongooseConfig': CONFIG_NAME
  };
  try {
    const response = await axios.get(url, { params, headers });
    if (response.data && response.data.Items) {
      return response.data.Items;
    }
    throw new Error('Invalid response structure');
  } catch (err) {
    console.error('Error loading collection', err.message);
    throw err;
  }
}

// Utility to classify product vs service based on product code. Adjust the
// value of SERVICE_CODES to match your implementation.
const SERVICE_CODES = new Set(['SERVICE', 'SV', 'SVR']);
function classifyItem(productCode) {
  if (!productCode) return 'Product';
  const code = String(productCode).trim().toUpperCase();
  return SERVICE_CODES.has(code) ? 'Service' : 'Product';
}

// Endpoint: /api/order
// Aggregates sales by order/ship date using SLCoitems.
// Returns an array of { date, type, amount } entries.
app.get('/api/order', async (req, res) => {
  try {
    const props = [
      'RecordDate',
      'ExtendedPrice',
      'WBItProductCode'
    ];
    const items = await loadCollection('SLCoitems', props);
    const resultMap = {};
    items.forEach(item => {
      const dateStr = item.RecordDate ? item.RecordDate.split(' ')[0] : null;
      const amount = parseFloat(item.ExtendedPrice) || 0;
      const type = classifyItem(item.WBItProductCode);
      if (!dateStr || !amount) return;
      if (!resultMap[dateStr]) resultMap[dateStr] = {};
      if (!resultMap[dateStr][type]) resultMap[dateStr][type] = 0;
      resultMap[dateStr][type] += amount;
    });
    const result = [];
    Object.entries(resultMap).forEach(([date, types]) => {
      Object.entries(types).forEach(([type, amount]) => {
        result.push({ date, type, amount });
      });
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load order data' });
  }
});

// Aggregates sales by invoice date using SLLedgers.
app.get('/api/invoice', async (req, res) => {
  try {
    const props = [
      'FRDerInvDate',
      'DomAmount',
      'FRDerDescription',
      'DerItemProductCode',
      'ItemProductCode',
      'NonInvItemProductCode'
    ];
    const ledgers = await loadCollection('SLLedgers', props);
    const resultMap = {};
    ledgers.forEach(row => {
      const dateStr = row.FRDerInvDate ? row.FRDerInvDate.split(' ')[0] : null;
      const amount =Math.abs(parseFloat(row.DomAmount)) || 0) || 0;
      if (!dateStr || amount === 0) return;

      let type;
      const desc = (row.FRDerDescription || '').toLowerCase();
      if (desc.includes('freight')) {
        type = 'Freight';
      } else if (desc.includes('misc')) {
        type = 'Misc';
      } else {
        const prodCode = String(row.DerItemProductCode || row.ItemProductCode || row.NonInvItemProductCode || '').toUpperCase();
        type = classifyItem(prodCode);
      }

      if (!resultMap[dateStr]) resultMap[dateStr] = {};
      if (!resultMap[dateStr][type]) resultMap[dateStr][type] = 0;
      resultMap[dateStr][type] += amount;
    });
    const result = [];
    Object.entries(resultMap).forEach(([date, types]) => {
      Object.entries(types).forEach(([type, amount]) => {
        result.push({ date, type, amount });
      });
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load invoice data' });
  }
});

// Serve static files from the public directory
app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
