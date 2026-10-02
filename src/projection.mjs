import {importFanaticalOrdersInPage} from './order-importer.mjs';

// Execute the same projector used by the serialized live importer.
export function projectOrderHistory(orderSummaries,orderDetails){
  return importFanaticalOrdersInPage({operation:'project',orderSummaries,orderDetails});
}
