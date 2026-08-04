const { DisconnectReason } = require('@whiskeysockets/baileys');

// Network-level failures never carry a WhatsApp status code.
const OFFLINE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// Translates a WhatsApp disconnect into something a human can act on.
// `kind` is for callers that need to branch (restart vs. give up);
// `message` is what gets shown.
function describeDisconnect(statusCode, error) {
  const errorCode = error && (error.code || error.errno);

  if (!statusCode && OFFLINE_ERROR_CODES.has(errorCode)) {
    return {
      kind: 'offline',
      message:
        'Cannot reach WhatsApp — no internet connection. Check your network and try again.',
    };
  }

  switch (statusCode) {
    case DisconnectReason.restartRequired: // 515
      return {
        kind: 'restart',
        message: 'WhatsApp asked for a reconnect to finish setting up this device.',
      };

    case DisconnectReason.loggedOut: // 401
      return {
        kind: 'expired',
        message:
          'This device was unlinked from WhatsApp (session expired). Delete .familyos/whatsapp-session and run "npm run whatsapp:link" again.',
      };

    case DisconnectReason.badSession: // 500
      return {
        kind: 'expired',
        message:
          'The saved WhatsApp session is corrupted. Delete .familyos/whatsapp-session and run "npm run whatsapp:link" again.',
      };

    case DisconnectReason.forbidden: // 403
      return {
        kind: 'rejected',
        message:
          'WhatsApp rejected this device (pairing refused). This usually means the code/QR expired or the account is restricted. Try linking again.',
      };

    case DisconnectReason.multideviceMismatch: // 411
      return {
        kind: 'version',
        message:
          'WhatsApp refused the connection due to a multi-device version mismatch. Update the Baileys dependency ("npm update @whiskeysockets/baileys") and try again.',
      };

    case 405:
      return {
        kind: 'version',
        message:
          'WhatsApp rejected the connection handshake (405) — the WhatsApp Web version being used is no longer accepted. Retry; if it keeps failing, update the Baileys dependency ("npm update @whiskeysockets/baileys").',
      };

    case 429:
      return {
        kind: 'ratelimited',
        message:
          'WhatsApp is rate-limiting this number (too many pairing attempts). Wait a few minutes before trying again.',
      };

    case DisconnectReason.timedOut: // 408
      return {
        kind: 'offline',
        message:
          'The connection to WhatsApp timed out. Check your internet connection and try again.',
      };

    case DisconnectReason.unavailableService: // 503
      return {
        kind: 'reconnect',
        message: 'WhatsApp service is temporarily unavailable. Try again shortly.',
      };

    case DisconnectReason.connectionReplaced: // 440
      return {
        kind: 'reconnect',
        message:
          'Another session took over this WhatsApp device. Only one FamilyOS session can be connected at a time — close the other one and try again.',
      };

    case DisconnectReason.connectionClosed: // 428
      return {
        kind: 'reconnect',
        message: 'WhatsApp closed the connection. Reconnect required — try again.',
      };

    default:
      return {
        kind: 'unknown',
        message: `WhatsApp connection closed unexpectedly${
          statusCode ? ` (status ${statusCode})` : ''
        }${error && error.message ? `: ${error.message}` : '.'}`,
      };
  }
}

module.exports = { describeDisconnect };
