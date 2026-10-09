require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function loadPriceSheet(filepath) {
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);
  return rawRows.map(row => {
    const cleanRow = {};
    for (const key in row) {
      cleanRow[key.trim()] = row[key];
    }
    return cleanRow;
  });
}

function extractProductKeyword(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (lower.includes('distribution board')) {
    const match = lower.match(/distribution board[^,.]*(d4|d6|d8)?[^,.]*(single phase|three phase)?/);
    return match ? match[0].trim() : 'distribution board';
  }

  const knownProducts = [
    'cable', 'flood light', 'solar', 'knockout box', 'conduit', 'elcb', 'socket', 'switch', 'bulb'
  ];
  return knownProducts.find(product => lower.includes(product)) || null;
}

function findPrice(productAsked, priceSheet) {
  if (!productAsked) return null;
  const searchTokens = productAsked.toLowerCase().split(/\s+/);
  const match = priceSheet.find(row => {
    const desc = row["Description of goods"];
    if (!desc) return false;
    const descLower = desc.toLowerCase();
    return searchTokens.every(token => descLower.includes(token));
  });
  return match ? match["price we sell at"] : null;
}

function mapKeywordToTier(keyword) {
  if (!keyword) return null;
  if (keyword.includes('distribution board')) return { category: 'Distribution Board', threshold: 35000 };
  if (keyword === 'conduit' || keyword === 'knockout box') return { category: 'Box/Conduit', threshold: 2500 };
  if (keyword === 'solar' || keyword === 'flood light') return { category: 'Solar/Flood Light', threshold: 34000 };
  return null;
}

function scoreLeadForCall(row, estimatedValue, tierInfo) {
  if (row.known_competitor || row.already_purchased || row.opted_out) {
    return { call: false, reason: 'disqualified' };
  }

  const hoursSinceEnquiry = (new Date() - new Date(row.created_at)) / (1000 * 60 * 60);
  if (hoursSinceEnquiry > 72 || row.whatsapp_responded) {
    return { call: false, reason: 'stale or already engaged' };
  }

  if (!tierInfo) return { call: false, reason: 'not a Tier 1/2 category' };
  if (estimatedValue === null || estimatedValue < tierInfo.threshold) {
    return { call: false, reason: 'below tier threshold' };
  }

  return { call: true, reason: 'qualified', category: tierInfo.category, estimatedValue };
}

async function fetchAndScore() {
  const { data: enquiries, error } = await supabase
    .from('enquiries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Supabase error:', error);
    return;
  }

  const prices = loadPriceSheet('prices.xlsx');

  const results = enquiries.map(row => {
    const keyword = extractProductKeyword(row.product_asked);
    const estimatedValue = keyword ? findPrice(keyword, prices) : null;
    const tierInfo = mapKeywordToTier(keyword);
    const scoring = scoreLeadForCall(row, estimatedValue, tierInfo);

    return {
      id: row.id,
      product_asked: row.product_asked,
      matched_keyword: keyword,
      estimated_value: estimatedValue,
      ...scoring
    };
  });

  console.log(results);
}

fetchAndScore();