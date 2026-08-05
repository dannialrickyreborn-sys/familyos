// The WhatsApp delivery channel. This is the only file in the notification
// layer permitted to import a transport, and it does not read the recipient's
// number: it forwards the member record and lets the transport resolve the
// address. That keeps phone numbers inside the transport layer.
const { sendToMember } = require('../../transports/whatsapp');

module.exports = {
  name: 'whatsapp',
  send: (member, message) => sendToMember(member, message),
};
