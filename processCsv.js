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
  console.log({discrepancies})
  console.log({newInventory})
  const newCsv = getCsvFromInventory(newInventory);
  saveFile(newCsv);
}

const getInventoryFromCsv = (parsedData) => {
  const inventory = {};
  const invalidRows = [];
  for (let i = 1; i < parsedData.length; i++) {
    if (!parsedData[i] || !parsedData[i][0]) {
      continue
    }
    const row = parsedData[i];
    const color = row[COLOR_INDEX]
    const sku = row[SKU_INDEX]
    const thisQuantity = row[QUANTITY_INDEX]
    const revenue = row[REVENUE_INDEX]

    let skuParts = sku.split(/[-_]/)
    let thisVariation = '';
    const numOfUnderscores = sku.split('-').length - 1;
    if (numOfUnderscores >= 3) {
      const sku_0 = skuParts[0];
      const sku_1 = skuParts[1];
      const sku_2 = skuParts[2];
      thisVariation = sku.slice(sku_0.length + sku_1.length + sku_2.length + 3);
    } else {
      skuParts = sku.split('_');
      thisVariation = skuParts.slice(1).join('_');
    }
    const parentSku = sku.slice(0, sku.length - thisVariation.length);
    let parentSkuKey = parentSku;
    
    // handling the ends with "A" case:
    if (parentSku.endsWith('A_') || parentSku.endsWith('A-')) {
      parentSkuKey = parentSku.slice(0, - 2) + parentSku.slice(- 1)
    }
    
    if (thisVariation) {
      const object = {
        quantity: parseInt(thisQuantity),
        revenue: Number(revenue),
        color,
        parent: parentSku
      }
      if (!inventory[parentSkuKey]) {
        inventory[parentSkuKey] = {
          [thisVariation]: object
        }
      } else {
        inventory[parentSkuKey][thisVariation] = object;
      }
    } else {
      // this sku is invalid
      invalidRows.push(parsedData[i])
      discrepancies.push({reason: 'Variation', sku, description: `Variation not recognized: ${thisVariation}`});
    }
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
      delete variants.isIgnored
    }
    for (const variant in variants) {
      const { quantity, revenue, color, parent} = variants[variant];
      const sku = `${parent}${variant}`;
      csv += `${color},${sku},${quantity},${revenue},${isIgnored ? `+${isIgnored}+` : ''}\n`;
    }
  }

  return csv;
}

const getCountForThisVariation = (variation) => {
  if (variation.includes('4')) {
    return 4
  } else if (variation.includes('2')) {
    return 2
  } else {
    return 1
  }
}