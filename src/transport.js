// Lazily loads the requested transport so commands that don't need
// WhatsApp (doctor, config, console-only brief) never pay for loading it.
function getTransport(name) {
  if (name === 'console') {
    return require('./transports/console');
  }

  if (name === 'whatsapp') {
    return require('./transports/whatsapp');
  }

  throw new Error(`Unknown transport: ${name}. Available: console, whatsapp`);
}

module.exports = { getTransport };
