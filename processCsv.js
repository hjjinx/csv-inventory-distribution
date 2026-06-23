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
      newInventory[parentSku]._preTotal = totalProduct;
      newInventory[parentSku]._postTotal = totalProduct;
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
      newInventory[parentSku]._preTotal = totalProduct;
      newInventory[parentSku]._postTotal = totalProduct;
    } else {
      newInventory[parentSku]._preTotal = totalProduct;
      newInventory[parentSku]._postTotal = finalTotalUsedProduct;
    }
  }
  const newCsv = getCsvFromInventory(newInventory, invalidRows);
  saveFile(newCsv);
}

const getInventoryFromCsv = (parsedData) => {
  const inventory = {};
  const invalidRows = [];

  for (let i = 1; i < parsedData.length; i++) {
    if (!parsedData[i] || !parsedData[i][0]) continue;
    const row = parsedData[i];
    if (row.length < 4) { invalidRows.push(row); continue; }

    const color = row[COLOR_INDEX];
    const sku = row[SKU_INDEX];
    const thisQuantity = row[QUANTITY_INDEX];
    const revenue = row[REVENUE_INDEX];

    // Determine the parent SKU key. SKUs with 3+ dashes use the first three
    // dash-separated segments (handles COV-embedded format like WR70019-3-17-COV-2pcs).
    // Otherwise the parent is everything before the first underscore. In both cases a
    // trailing 'A' is stripped so A-listings group with their non-A counterpart.
    const numOfDashes = sku.split('-').length - 1;
    let parsedParentSku;
    if (numOfDashes >= 3) {
      const [s0, s1, s2] = sku.split(/[-_]/);
      parsedParentSku = sku.slice(0, s0.length + s1.length + s2.length + 3);
    } else {
      parsedParentSku = sku.split('_')[0];
    }
    let parentSkuKey = parsedParentSku.replace(/[-_]$/, '');
    if (parentSkuKey.endsWith('A')) parentSkuKey = parentSkuKey.slice(0, -1);

    // Variation = everything after the parent key. This includes the leading separator
    // or 'A', giving A-variants a distinct key (e.g. "A_1pcs_INS") from non-A ("_1pcs_INS").
    const thisVariation = sku.slice(parentSkuKey.length);

    if (thisVariation) {
      const object = { quantity: parseInt(thisQuantity), revenue: Number(revenue), color, parent: parentSkuKey };
      if (!inventory[parentSkuKey]) {
        inventory[parentSkuKey] = { [thisVariation]: object };
      } else if (inventory[parentSkuKey][thisVariation]) {
        // Exact duplicate variation key: merge quantities and revenue.
        inventory[parentSkuKey][thisVariation].quantity += parseInt(thisQuantity);
        inventory[parentSkuKey][thisVariation].revenue += Number(revenue);
      } else {
        inventory[parentSkuKey][thisVariation] = object;
      }
    } else {
      // No variation could be parsed (e.g. bare product code with no suffix).
      invalidRows.push(row);
      discrepancies.push({ reason: 'Variation', sku, description: 'No variation could be inferred for this SKU' });
    }
  }

  return [inventory, invalidRows];
}

const getCsvFromInventory = (inventory, invalidRows = []) => {
  let csv = 'Color,Supplier Part Number,Current Available Quantity,Revenue,Not Processed Reason,Pre-dist Total (units),Post-dist Total (units)\n';

  for (const parentSku in inventory) {
    const variants = inventory[parentSku];
    let isIgnored, preTotal, postTotal;
    if ('isIgnored' in variants) { isIgnored = variants.isIgnored; delete variants.isIgnored; }
    if ('_preTotal' in variants) { preTotal = variants._preTotal; delete variants._preTotal; }
    if ('_postTotal' in variants) { postTotal = variants._postTotal; delete variants._postTotal; }

    for (const variant in variants) {
      const { quantity, revenue, color, parent } = variants[variant];
      const sku = `${parent}${variant}`;
      csv += `${color},${sku},${quantity},${revenue},${isIgnored ? `+${isIgnored}+` : ''},,\n`;
    }

    if (preTotal !== undefined) {
      csv += `,${parentSku},,,SUMMARY,${preTotal},${postTotal}\n`;
    }
  }

  // Rows that could not be parsed (too few columns or no variation found) are
  // appended as-is so every input row appears in the output.
  for (const row of invalidRows) {
    const [color, sku, qty, revenue] = row;
    csv += `${color || ''},${sku || ''},${qty || ''},${revenue || ''},NOT PROCESSED,,\n`;
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
    resetDiscrepancies: () => { discrepancies = []; },
    getDiscrepancies: () => discrepancies,
  };
}