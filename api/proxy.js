const { netlifyToVercel } = require('./_adapter');
const { handler } = require('../netlify/functions/proxy');
module.exports = (req, res) => netlifyToVercel(handler, req, res);
