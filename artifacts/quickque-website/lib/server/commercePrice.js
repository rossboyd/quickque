const PRICE_ENV_KEY = 'QUICKQUE_PRICE_GBP';

export function readCommercePrice(rawValue = process.env[PRICE_ENV_KEY]) {
  if (typeof rawValue !== 'string' || !/^[1-9]\d{0,5}(?:\.\d{1,2})?$/.test(rawValue.trim())) {
    throw new Error(`${PRICE_ENV_KEY} must be a positive GBP amount with no more than two decimal places.`);
  }

  const amount = Math.round(Number(rawValue.trim()) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${PRICE_ENV_KEY} is outside the supported price range.`);
  }

  return {
    amount,
    currency: 'gbp',
    displayPrice: new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount / 100)
  };
}

export const COMMERCE_PRICE = readCommercePrice();