const { netlifyToVercel } = require('./_adapter');
const { handler } = require('../netlify/functions/page-to-rss');
module.exports = (req, res) => netlifyToVercel(handler, req, res);
