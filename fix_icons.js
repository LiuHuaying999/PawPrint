const fs = require('fs');

let bg = fs.readFileSync('background.js', 'utf8');

bg = bg.replace(/\`icons\/labels\/\$\{existingTask\.labelIcon\}\`/g, "\`icons/labels/${existingTask.labelIcon || '开心.png'}\`");
bg = bg.replace(/\`icons\/labels\/\$\{unknownTask\.labelIcon\}\`/g, "\`icons/labels/${unknownTask.labelIcon || '开心.png'}\`");
bg = bg.replace(/\`icons\/labels\/\$\{newTask\.labelIcon\}\`/g, "\`icons/labels/${newTask.labelIcon || '开心.png'}\`");

fs.writeFileSync('background.js', bg);
console.log('Fixed icon paths fallback');
