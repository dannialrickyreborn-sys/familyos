// Normalizes a user-typed phone number to E.164.
// WhatsApp's pairing API wants digits only (no "+"), but we keep the
// "+" form for display so the user can confirm what they typed.
function normalizePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Phone number is required.');
  }

  let digits = raw.replace(/[^\d]/g, '');

  // "00" is the international dialling prefix in many countries; E.164 uses "+".
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (!digits) {
    throw new Error(`"${raw}" does not contain any digits.`);
  }

  if (digits.startsWith('0')) {
    throw new Error(
      `"${raw}" looks like a national number. Include the country code, e.g. +62 for Indonesia.`
    );
  }

  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      `"${raw}" is not a valid international number (expected 8-15 digits including country code, got ${digits.length}).`
    );
  }

  return { digits, e164: `+${digits}` };
}

module.exports = { normalizePhone };
