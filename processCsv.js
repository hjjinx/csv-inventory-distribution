const ALLOWED_VARIATIONS = [
  '1pcs_COV',
  '2pcs_COV',
  '4pcs_COV',
  '1pcs_INS',
  '2pcs_INS',
  '4pcs_INS',
]

const COLOR_INDEX = 0;
const SKU_INDEX = 1;
const QUANTITY_INDEX = 2;
const REVENUE_INDEX = 3;

const MIN_AMOUNT = 2;

let discrepancies = []

const processCsv = (parsedData) => {
  discrepancies = [];

  const [inventory, invalidRows] = getInventoryFromCsv(parsedData)
  const newInventory = JSON.parse(JSON.stringify(inventory));
  console.log(`Invalid Rows: ${invalidRows.length}\n`)

  for (let parentSku of Object.keys(newInventory)) {
    // if (Object.keys(newInventory[parentSku]).length < 3) {
    //   console.log(`WARNING: Disregarding ${parentSku} because there are less than 3 variations for this.`)
    //   continue;
    // }

    let variations = Object.keys(newInventory[parentSku]).sort((a, b) => parseInt(b) - parseInt(a))
    // console.log(variations)
    let totalProduct = 0;
    let totalProductUsed = 0;
    let totalRevenue = 0;
    let color = newInventory[parentSku][variations[0]]['color']
    let isColorDiscrepancyFound = false;
    for (let variation of variations) {
      totalProduct += newInventory[parentSku][variation].quantity * getCountForThisVariation(variation)
      totalRevenue += newInventory[parentSku][variation].revenue
      if (newInventory[parentSku][variation]['color'] != color) {
        isColorDiscrepancyFound = true;
        discrepancies.push({reason: 'Color', parentSku, description: `Colors: ${color}, ${newInventory[parentSku][variation]['color']}`});
        console.log(`Color discrepancy found! Parent SKU: ${parentSku}. Colors: ${color}, ${newInventory[parentSku][variation]['color']}`);
      }
    }
    if (isColorDiscrepancyFound) continue;

    // first, assign MIN_AMOUNT to all products
    for (let variation of variations) {
      const productUsedForThisVariation = getCountForThisVariation(variation) * MIN_AMOUNT;
      if (productUsedForThisVariation + totalProductUsed <= totalProduct) {
        totalProductUsed += productUsedForThisVariation;
        newInventory[parentSku][variation].quantity = MIN_AMOUNT;
      }
    }

    // sort variations according to revenue
    variations = variations.sort((a, b) => newInventory[parentSku][b].revenue - newInventory[parentSku][a].revenue)
    // Now, distribute the rest according to revenue
    for (let variation of variations) {
      const revenueRatio = newInventory[parentSku][variation].revenue / totalRevenue;
      let thisQuantity = Math.ceil((totalProduct * revenueRatio) / getCountForThisVariation(variation));
      if (String(thisQuantity) == 'NaN') thisQuantity = 0

      let productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      while (totalProduct - (totalProductUsed + productUsedForThisVariation) < 0) {
        if (totalProductUsed == 0) {
          thisQuantity = 0;
          productUsedForThisVariation = 0;
          break;
        }
        thisQuantity--;
        productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      }
      totalProductUsed += productUsedForThisVariation
      
      newInventory[parentSku][variation].quantity += thisQuantity;
    }

    // distribute remaning quantity into the smallest variant:
    if (totalProductUsed != totalProduct) {
      // selecting smallest variant
      const remainingProduct = totalProduct - totalProductUsed;
      
      const variation = variations.sort((a, b) => parseInt(a) - parseInt(b))[0]
      let thisQuantity = Math.ceil(remainingProduct / getCountForThisVariation(variation));
      let productUsedForThisVariation = thisQuantity * getCountForThisVariation(variation);
      totalProductUsed += productUsedForThisVariation;
      newInventory[parentSku][variation].quantity += thisQuantity;

      if (totalProductUsed != totalProduct) {
        console.log(`total product not used for ${parentSku}, quantity: ${remainingProduct}`)
      }
    }
  }
  console.log()
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

    const skuParts = sku.split('-')
    const skuParts2 = sku.split('_')
    let thisVariation;
    if (skuParts[3]) {
      thisVariation = skuParts[3];
    } else {
      if (skuParts2.length >= 2) {
        thisVariation = skuParts2.slice(1).join('_')
      }
    }
    if (thisVariation && ALLOWED_VARIATIONS.includes(thisVariation)) {
      let parentSku;
      if (skuParts[3]) {
        parentSku = skuParts.slice(0,3).join('-');
      } else {
        parentSku = skuParts2.slice(0,1).join('_');
      }
      const object = {
        quantity: parseInt(thisQuantity),
        revenue: Number(revenue),
        color
      }
      if (!inventory[parentSku]) {
        inventory[parentSku] = {
          [thisVariation]: object
        }
      } else {
        inventory[parentSku][thisVariation] = object;
      }
    } else {
      // this sku is invalid
      invalidRows.push(parsedData[i])
    }
  }
  return [inventory, invalidRows];
}

const getCsvFromInventory = (inventory) => {
  let csv = 'Color,Supplier Part Number,Current Available Quantity,Revenue\n';

  for (const parentSku in inventory) {
    const variants = inventory[parentSku];

    for (const variant in variants) {
      const { quantity, revenue, color } = variants[variant];
      const sku = `${parentSku}_${variant}`;
      csv += `${color},${sku},${quantity},${revenue}\n`;
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