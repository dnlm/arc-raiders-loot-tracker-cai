// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'https://arcraiders.wiki';
const LOOT_PAGE = '/wiki/Loot';

async function fetchPage(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

async function getItemSellPrice(itemPath) {
  const fullUrl = `${BASE_URL}${itemPath}`;
  const html = await fetchPage(fullUrl);
  
  if (!html) return null;
  
  const $ = cheerio.load(html);
  
  // Look for sell price in the item page
  // This may need adjustment based on actual wiki structure
  let sellPrice = null;
  
  $('th').each((i, elem) => {
    const text = $(elem).text().trim().toLowerCase();
    if (text.includes('sell') || text === 'price') {
      const value = $(elem).next('td').text().trim();
      const match = value.match(/(\d+)/);
      if (match) {
        sellPrice = parseInt(match[1]);
      }
    }
  });
  
  return sellPrice;
}

function parseRecycleItems(recyclesToText) {
  if (!recyclesToText || recyclesToText === '-' || recyclesToText === 'N/A') {
    return [];
  }
  
  // Parse items like "2x Scrap Metal, 1x Circuit Board"
  const items = [];
  const parts = recyclesToText.split(',');
  
  for (const part of parts) {
    const match = part.trim().match(/(\d+)x?\s*(.+)/);
    if (match) {
      items.push({
        quantity: parseInt(match[1]),
        name: match[2].trim()
      });
    }
  }
  
  return items;
}

async function scrapeLootTable() {
  console.log('Fetching loot page...');
  const html = await fetchPage(`${BASE_URL}${LOOT_PAGE}`);
  
  if (!html) {
    throw new Error('Failed to fetch loot page');
  }
  
  const $ = cheerio.load(html);
  const items = [];
  
  // Find the main loot table
  const table = $('table').first();
  const headers = [];
  
  table.find('thead tr th').each((i, elem) => {
    headers.push($(elem).text().trim());
  });
  
  console.log('Table headers:', headers);
  
  // Process each row
  for (const row of table.find('tbody tr').toArray()) {
    const cells = $(row).find('td');
    
    if (cells.length === 0) continue;
    
    const item = {
      name: '',
      sellPrice: null,
      recyclesToText: '',
      recyclesToItems: [],
      recycledSellPrice: 0,
      link: ''
    };
    
    cells.each((i, cell) => {
      const text = $(cell).text().trim();
      const header = headers[i]?.toLowerCase() || '';
      
      if (header.includes('item') || header.includes('name')) {
        const link = $(cell).find('a').attr('href');
        item.name = text;
        item.link = link || '';
      } else if (header.includes('sell') || header.includes('price')) {
        const match = text.match(/(\d+)/);
        item.sellPrice = match ? parseInt(match[1]) : null;
      } else if (header.includes('recycle')) {
        item.recyclesToText = text;
        item.recyclesToItems = parseRecycleItems(text);
      }
    });
    
    if (item.name) {
      items.push(item);
    }
  }
  
  console.log(`Found ${items.length} items`);
  
  // Build a price lookup map
  const priceMap = new Map();
  for (const item of items) {
    if (item.sellPrice) {
      priceMap.set(item.name, item.sellPrice);
    }
  }
  
  // Calculate recycled sell prices
  console.log('Calculating recycled sell prices...');
  for (const item of items) {
    if (item.recyclesToItems.length === 0) {
      item.recycledSellPrice = 0;
      continue;
    }
    
    let totalValue = 0;
    let allPricesFound = true;
    
    for (const recycleItem of item.recyclesToItems) {
      let price = priceMap.get(recycleItem.name);
      
      // If not in table, try to fetch from individual page
      if (!price && item.link) {
        console.log(`Fetching price for ${recycleItem.name}...`);
        price = await getItemSellPrice(item.link);
        if (price) {
          priceMap.set(recycleItem.name, price);
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (price) {
        totalValue += price * recycleItem.quantity;
      } else {
        allPricesFound = false;
      }
    }
    
    item.recycledSellPrice = allPricesFound ? totalValue : null;
  }
  
  return items;
}

async function main() {
  try {
    const items = await scrapeLootTable();
    
    // Ensure data directory exists
    await fs.mkdir('data', { recursive: true });
    
    // Save to JSON file
    const outputPath = path.join('data', 'loot-data.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        lastUpdated: new Date().toISOString(),
        items: items
      }, null, 2)
    );
    
    console.log(`Successfully saved ${items.length} items to ${outputPath}`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();