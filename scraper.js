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
  
  console.log('Parsing page content...');
  
  // Method 1: Try to find the table structure
  let foundItems = false;
  
  // Look for table rows
  $('table tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 5) {
      foundItems = true;
      
      const nameCell = $(cells[0]);
      const nameLink = nameCell.find('a');
      
      const item = {
        name: nameLink.text().trim() || nameCell.text().trim(),
        link: nameLink.attr('href') || '',
        rarity: $(cells[1]).text().trim(),
        recyclesToText: $(cells[2]).text().trim(),
        recyclesToItems: parseRecycleItems($(cells[2]).text().trim()),
        sellPrice: null,
        recycledSellPrice: 0,
        category: $(cells[4]).text().trim() || 'Unknown'
      };
      
      // Parse sell price
      const priceText = $(cells[3]).text().trim();
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
    }
  });
  
  // Method 2: If no table found, parse the raw text content
  if (!foundItems) {
    console.log('No table found, parsing text content...');
    
    // Get all paragraphs and divs that might contain the data
    const textContent = $('body').text();
    const lines = textContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and lines without pipes
      if (!line || !line.includes('|')) continue;
      
      // Check if this looks like an item line (has markdown link format)
      if (!line.match(/\[.+?\]\(.+?\)/)) continue;
      
      // Split by pipe and filter empty
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      
      // Need at least 4 parts
      if (parts.length < 4) continue;
      
      // Extract name and link
      const nameMatch = parts[0].match(/\[(.+?)\]\((.+?)\)/);
      if (!nameMatch) continue;
      
      const item = {
        name: nameMatch[1],
        link: nameMatch[2],
        rarity: parts[1],
        recyclesToText: parts[2],
        recyclesToItems: parseRecycleItems(parts[2]),
        sellPrice: null,
        recycledSellPrice: 0,
        category: parts.length >= 5 ? parts[4] : 'Unknown'
      };
      
      // Parse sell price
      const priceText = parts[3];
      if (priceText && priceText !== '?') {
        const cleanPrice = priceText.replace(/,/g, '');
        const match = cleanPrice.match(/(\d+)/);
        if (match) {
          item.sellPrice = parseInt(match[1]);
        }
      }
      
      items.push(item);
    }
  }
  
  console.log(`Found ${items.length} items`);
  
  if (items.length === 0) {
    console.log('Debug: First 2000 chars of page:');
    console.log($('body').text().substring(0, 2000));
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