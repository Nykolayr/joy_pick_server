const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'api/routes/support'));
require(path.join(root, 'api/services/supportAiService'));
console.log('load_ok');
