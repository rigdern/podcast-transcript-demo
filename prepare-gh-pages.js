// Checkout a copy of this repo into ./_gh-pages point to the gh-pages branch.
// Then you can run this script to copy the relevant files into it.

const fs = require('fs');
const path = require('path');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// The .nojekyll file tells GitHub Pages it's okay to server directories that
// begin with an underscore. 
// For details see https://github.blog/2009-12-29-bypassing-jekyll-on-github-pages/
fs.writeFileSync('./_gh-pages/.nojekyll', '');

copyFile('./index.html', './_gh-pages/index.html');
copyFile('./_output/main.js', './_gh-pages/_output/main.js');
