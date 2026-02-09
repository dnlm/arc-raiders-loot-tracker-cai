// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'https://arcraiders.wiki';
const LOOT_PAGE = '/wiki/Loot';

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

function parseRecycleItems(recyclesToText) {
  if (!recyclesToText || recyclesToText === '-' || recyclesToText === 'N/A' || 
      recyclesToText.toLowerCase().includes('cannot be recycled') || recyclesToText === '?') {
    return [];
  }
  
  // Parse items like "2× Scrap Metal 1× Circuit Board"
  const items = [];
  
  // First, normalize the text by adding commas where missing between items
  // Match pattern: number+×+text followed by number+× (without comma between)
  let normalized = recyclesToText.replace(/([a-zA-Z])\s*(\d+×)/g, '$1, $2');
  
  // Now split by comma or just whitespace before digit+×
  const parts = normalized.split(/[,\s]+(?=\d+×)/);
  
  for (const part of parts) {
    const match = part.trim().match(/(\d+)\s*[×x]\s*(.+)/i);
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
  
  console.log('Parsing page content...');
  
  // Find the main loot table
  const table = $('table').first();
  
  // Process each row (skip header)
  table.find('tr').each((i, row) => {
    const cells = $(row).find('td');
    
    // Skip header rows or empty rows
    if (cells.length < 7) return;
    
    // Column indices (0-based):
    // 0: Image, 1: Item, 2: Rarity, 3: Recycles To, 4: Sell Price, 5: Stack Size, 6: Category, 7: Uses
    
    const imageCell = $(cells[0]); // Image column
    const imageTag = imageCell.find('img').first();
    const imageSrc = imageTag.attr('src') || '';
    
    const nameCell = $(cells[1]); // Item column
    const nameLink = nameCell.find('a').first();
    
    const item = {
      name: nameLink.text().trim() || nameCell.text().trim(),
      link: nameLink.attr('href') || '',
      image: imageSrc ? (imageSrc.startsWith('http') ? imageSrc : `${BASE_URL}${imageSrc}`) : '',
      rarity: $(cells[2]).text().trim(),
      recyclesToText: $(cells[3]).text().trim().replace(/([a-zA-Z])\s*(\d+×)/g, '$1, $2'),
      recyclesToItems: parseRecycleItems($(cells[3]).text().trim()),
      sellPrice: null,
      recycledSellPrice: 0,
      stackSize: $(cells[5]).text().trim(),
      category: $(cells[6]).text().trim() || 'Unknown',
      expedition: $(cells[7]).text().trim().toLowerCase().includes('expedition'),
      quest: $(cells[7]).text().trim().toLowerCase().includes('quest')
    };
    
    // Parse sell price from cells[4]
    const priceText = $(cells[4]).text().trim();
    if (priceText && priceText !== '?') {
      const cleanPrice = priceText.replace(/,/g, '');
      const match = cleanPrice.match(/(\d+)/);
      if (match) {
        item.sellPrice = parseInt(match[1]);
      }
    }
    
    if (item.name) {
      items.push(item);
    }
  });
  
  console.log(`Found ${items.length} items`);
  
  if (items.length === 0) {
    console.log('\n=== DEBUG: No items found ===');
    console.log('HTML length:', html.length);
    console.log('\nFirst 3000 chars of raw HTML:');
    console.log(html.substring(0, 3000));
    console.log('\n=== END DEBUG ===\n');
  } else {
    console.log('\nFirst 3 items parsed:');
    items.slice(0, 3).forEach((item, i) => {
      console.log(`${i + 1}. ${item.name} | Rarity: ${item.rarity} | Recycles: ${item.recyclesToText} | Price: ${item.sellPrice} | Category: ${item.category}`);
    });
  }
  
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
      
      if (price) {
        totalValue += price * recycleItem.quantity;
      } else {
        allPricesFound = false;
      }
    }
    
    item.recycledSellPrice = allPricesFound && totalValue > 0 ? totalValue : null;
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
    
    // Print some sample data for verification
    if (items.length > 0) {
      console.log('\nSample items:');
      items.slice(0, 3).forEach(item => {
        console.log(`- ${item.name}: Sell=${item.sellPrice}, Recycles to: ${item.recyclesToText}, Recycled Value=${item.recycledSellPrice}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();