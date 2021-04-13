// Checkout a copy of this repo into ./_gh-pages point to the gh-pages branch.
// Then you can run this script to copy the relevant files into it.

const fs = require('fs');
const path = require('path');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

copyFile('./index.html', './_gh-pages/index.html');
copyFile('./_output/main.js', './_gh-pages/_output/main.js');
