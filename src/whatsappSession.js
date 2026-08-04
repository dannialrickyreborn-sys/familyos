const path = require('path');

// Kept separate from transports/whatsapp.js so doctor.js can check link
// status by reading a file, without loading the Baileys library.
const SESSION_DIR = path.join(process.cwd(), '.familyos', 'whatsapp-session');

module.exports = { SESSION_DIR };
