/**
 * Parses a TikTok comment for a bid amount.
 * Accepted formats: "bid 100", "Bid: 100", "$100", "100"
 * Returns the numeric amount, or null if the comment isn't a bid.
 *
 * Bid *state* (current bid, history, rules) lives in store.js now —
 * this file only handles turning raw chat text into a number.
 */
export function parseBid(commentText) {
  if (!commentText) return null;

  const text = commentText.trim();

  // "bid 100", "bid: 100", "BID 100"
  const bidWordMatch = text.match(/^bid[:\s]*\$?\s*([\d,]+(\.\d{1,2})?)$/i);
  if (bidWordMatch) {
    return parseAmount(bidWordMatch[1]);
  }

  // "$100", "$ 100"
  const dollarMatch = text.match(/^\$\s*([\d,]+(\.\d{1,2})?)$/);
  if (dollarMatch) {
    return parseAmount(dollarMatch[1]);
  }

  // Plain number only, e.g. "100" — nothing else in the message
  const plainNumberMatch = text.match(/^([\d,]+(\.\d{1,2})?)$/);
  if (plainNumberMatch) {
    return parseAmount(plainNumberMatch[1]);
  }

  return null;
}

function parseAmount(rawNumber) {
  const cleaned = rawNumber.replace(/,/g, "");
  const value = parseFloat(cleaned);
  if (isNaN(value) || value <= 0) return null;
  // Reject unreasonably large bids (likely typos), cap at $1,000,000 for demo safety
  if (value > 1_000_000) return null;
  return value;
}
