const { netlifyToVercel } = require('./_adapter');
const { handler } = require('../netlify/functions/books');
module.exports = (req, res) => netlifyToVercel(handler, req, res);
