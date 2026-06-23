const COLOR_INDEX = 0;
const SKU_INDEX = 1;
const QUANTITY_INDEX = 2;
const REVENUE_INDEX = 3;

let discrepancies = []

const processCsv = (parsedData) => {
  discrepancies = [];

  const [inventory, invalidRows] = getInventoryFromCsv(parsedData)
  const newInventory = JSON.parse(JSON.stringify(inventory));
  for (let parentSku of Object.keys(newInventory)) {
    // if (Object.keys(newInventory[parentSku]).length < 3) {
    //   console.log(`WARNING: Disregarding ${parentSku} because there are less than 3 variations for this.`)
    //   continue;
    // }

    let variations = Object.keys(newInventory[parentSku]).sort((a, b) => parseInt(b) - parseInt(a))
    // console.log(variations)
    let totalProduct = 0;
    let totalProductUsed = 0;
    let minProductRequiredToHaveOneQuantityForAllVariations = 0;
    let totalRevenue = 0;
    let color = newInventory[parentSku][variations[0]]['color']
    let isColorDiscrepancyFound = false;
    let minQuantity = 1;
    for (let variation of variations) {
      totalProduct += newInventory[parentSku][variation].quantity * getCountForThisVariation(variation)
      totalRevenue += Math.max(1, newInventory[parentSku][variation].revenue)
      newInventory[parentSku][variation].quantity = 0;
      minProductRequiredToHaveOneQuantityForAllVariations += getCountForThisVariation(variation)
      if (newInventory[parentSku][variation]['color'] != color) {
        isColorDiscrepancyFound = true;
        discrepancies.push({reason: 'Color', parentSku, description: `Colors: ${color}, ${newInventory[parentSku][variation]['color']}`});
        newInventory[parentSku].isIgnored = 'Color';
      }
    }

    if (isColorDiscrepancyFound) {
      newInventory[parentSku] = inventory[parentSku];
      newInventory[parentSku].isIgnored = 'Color';
      continue;
    }

    if (totalProduct > minProductRequiredToHaveOneQuantityForAllVariations * 10) minQuantity = 5;
    else if (totalProduct > minProductRequiredToHaveOneQuantityForAllVariations * 8) minQuantity = 4;
    else if (totalProduct > minProductRequiredToHaveOneQuantityForAllVariations * 6) minQuantity = 3;
    else if (totalProduct > minProductRequiredToHaveOneQuantityForAllVariations * 4) minQuantity = 2;
    else if (totalProduct >= minProductRequiredToHaveOneQuantityForAllVariations) minQuantity = 1;
    else minQuantity = 0;

    if (minQuantity > 0) {
      // first, assign MIN_AMOUNT to all products
      for (let variation of variations) {
        
        const productUsedForThisVariation = getCountForThisVariation(variation) * minQuantity;
        if (productUsedForThisVariation + totalProductUsed <= totalProduct) {
          totalProductUsed += productUsedForThisVariation;
          newInventory[parentSku][variation].quantity = minQuantity;
        }
      }
    }
    let productRemainingAfterMinAssignment = totalProduct - totalProductUsed;
    
    // sort variations according to revenue
    variations = variations.sort((a, b) => newInventory[parentSku][b].revenue - newInventory[parentSku][a].revenue)
    // Now, distribute the rest according to revenue
    for (let variation of variations) {
      const revenueRatio = Math.max(1, newInventory[parentSku][variation].revenue) / totalRevenue;
      let thisQuantity = Math.ceil(((productRemainingAfterMinAssignment) * revenueRatio) / getCountForThisVariation(variation));
      if (String(thisQuantity) == 'NaN') thisQuantity = 0

      let productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      while (totalProduct - (totalProductUsed + productUsedForThisVariation) < 0) {
        // this commented code below is very wrong, not sure why I wrote this.
        // if (totalProductUsed == 0) {
        //   thisQuantity = 0;
        //   productUsedForThisVariation = 0;
        //   break;
        // }
        thisQuantity--;
        productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      }
      totalProductUsed += productUsedForThisVariation
      
      newInventory[parentSku][variation].quantity += thisQuantity;
    }

    // distribute remaning quantity into the smallest variant:
    if (totalProductUsed != totalProduct) {
      const remainingProduct = totalProduct - totalProductUsed;
      
      // selecting smallest variant
      const variation = variations.sort((a, b) => a.replace(/[^0-9]/g, '') - b.replace(/[^0-9]/g, ''))[0]
      let thisQuantity = Math.ceil(remainingProduct / getCountForThisVariation(variation));
      let productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      totalProductUsed += productUsedForThisVariation;
      newInventory[parentSku][variation].quantity += thisQuantity;
    }
    
    // verifying that all but no extra product was used:
    let finalTotalUsedProduct = 0
    for (let variation of variations) {
      finalTotalUsedProduct += newInventory[parentSku][variation].quantity * getCountForThisVariation(variation)
    }
    if (finalTotalUsedProduct != totalProduct) {
      newInventory[parentSku] = inventory[parentSku];
      discrepancies.push({reason: 'Quantity', parentSku, description: `Quantity mismatch. Unable to divide quantities.`});
      newInventory[parentSku].isIgnored = 'Quantity';
    }
  }
  const newCsv = getCsvFromInventory(newInventory);
  saveFile(newCsv);
}

// Returns the longest string that is a prefix of both a and b.
const longestCommonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

const getInventoryFromCsv = (parsedData) => {
  const inventory = {};
  const invalidRows = [];

  // Collect valid data rows (skip header).
  const rows = [];
  for (let i = 1; i < parsedData.length; i++) {
    if (!parsedData[i] || !parsedData[i][0]) continue;
    if (parsedData[i].length < 4) { invalidRows.push(parsedData[i]); continue; }
    rows.push(parsedData[i]);
  }

  // Group consecutive rows into blocks. Each block shares the same product; the
  // block's parent is the longest common prefix (LCP) of all SKUs in the block.
  //
  // Block boundary rule: when the next SKU diverges from the running LCP at a bare
  // digit (not the start of a pack-size token like "2pcs"), we've hit a product-code
  // number boundary and must start a new block. Separators (-, _) and letters (A, COV…)
  // at the divergence point mean we're still in the same product family.
  let i = 0;
  while (i < rows.length) {
    let blockLcp = rows[i][SKU_INDEX];
    let j = i + 1;

    while (j < rows.length) {
      const nextSku = rows[j][SKU_INDEX];
      const newLcp = longestCommonPrefix(blockLcp, nextSku);
      const suffixInNext  = nextSku.slice(newLcp.length);
      const suffixInBlock = blockLcp.slice(newLcp.length);

      // New block if either side diverges at a bare digit that isn't a pack-size token.
      const bareDigitInNext  = /\d/.test(suffixInNext[0])  && !/^\d+pcs/.test(suffixInNext);
      const bareDigitInBlock = /\d/.test(suffixInBlock[0]) && !/^\d+pcs/.test(suffixInBlock);
      if (bareDigitInNext || bareDigitInBlock) {
        break; // nextSku is start of new block
      }

      blockLcp = newLcp;
      j++;
    }

    // Process all rows in this block. The variation is everything after the block LCP,
    // so A-variants (e.g. "A_2pcs_INS") and normal variants ("_2pcs_INS") get distinct
    // variation keys and each receive their own inventory allocation.
    for (let k = i; k < j; k++) {
      const row = rows[k];
      const color = row[COLOR_INDEX];
      const sku = row[SKU_INDEX];
      const thisQuantity = row[QUANTITY_INDEX];
      const revenue = row[REVENUE_INDEX];
      const thisVariation = sku.slice(blockLcp.length);

      if (thisVariation) {
        const object = { quantity: parseInt(thisQuantity), revenue: Number(revenue), color, parent: blockLcp };
        if (!inventory[blockLcp]) {
          inventory[blockLcp] = { [thisVariation]: object };
        } else if (inventory[blockLcp][thisVariation]) {
          // Exact duplicate SKU within the same block: merge quantities.
          inventory[blockLcp][thisVariation].quantity += parseInt(thisQuantity);
          inventory[blockLcp][thisVariation].revenue += Number(revenue);
        } else {
          inventory[blockLcp][thisVariation] = object;
        }
      } else {
        // Single-row block with no siblings: cannot infer a variation.
        invalidRows.push(row);
        discrepancies.push({ reason: 'Variation', sku, description: 'No variation could be inferred for standalone SKU' });
      }
    }

    i = j;
  }

  return [inventory, invalidRows];
}

const getCsvFromInventory = (inventory) => {
  let csv = 'Color,Supplier Part Number,Current Available Quantity,Revenue,Not Processed Reason\n';

  for (const parentSku in inventory) {
    const variants = inventory[parentSku];
    let isIgnored;
    if ('isIgnored' in variants) {
      isIgnored = variants.isIgnored;
      delete variants.isIgnored;
    }
    for (const variant in variants) {
      const { quantity, revenue, color, parent } = variants[variant];
      const sku = `${parent}${variant}`;
      csv += `${color},${sku},${quantity},${revenue},${isIgnored ? `+${isIgnored}+` : ''}\n`;
    }
  }

  return csv;
}

const getCountForThisVariation = (variation) => {
  const match = variation.match(/(\d+)pcs/);
  if (match) return parseInt(match[1]);
  if (variation.includes('4')) return 4;
  if (variation.includes('2')) return 2;
  return 1;
}

// Node.js export for test.js
if (typeof module !== 'undefined') {
  module.exports = {
    getInventoryFromCsv,
    longestCommonPrefix,
    resetDiscrepancies: () => { discrepancies = []; },
    getDiscrepancies: () => discrepancies,
  };
}