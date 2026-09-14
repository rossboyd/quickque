const PRICE_ENV_KEY = 'QUICKQUE_PRICE_GBP';

export function readCommercePrice(rawValue = process.env[PRICE_ENV_KEY]) {
  if (typeof rawValue !== 'string' || !/^[1-9]\d{0,5}(?:\.\d{1,2})?$/.test(rawValue.trim())) {
    throw new Error(`${PRICE_ENV_KEY} must be a positive GBP amount with no more than two decimal places.`);
  }

  const amount = Math.round(Number(rawValue.trim()) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${PRICE_ENV_KEY} is outside the supported price range.`);
  }
  if (amount % 10 !== 0) {
    throw new Error(`${PRICE_ENV_KEY} must divide evenly into ten monthly payments at GBP penny precision.`);
  }

  const monthlyAmount = amount / 10;
  const format = (value) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: value % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value / 100);

  return {
    amount,
    monthlyAmount,
    currency: 'gbp',
    displayPrice: format(amount),
    monthlyDisplayPrice: format(monthlyAmount)
  };
}

export const COMMERCE_PRICE = readCommercePrice();