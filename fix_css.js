const fs = require('fs');

let css = fs.readFileSync('popup.css', 'utf8');

// remove all instances of the block
css = css.replace(/\/\* 爪印时间轴样式 \*\/[\s\S]*?(?=\/\*|$)/g, '');

const newCSS = `/* 爪印时间轴样式 */
#cards-container {
  padding-left: 8px;
  position: relative;
}

#cards-container::before {
  content: "";
  position: absolute;
  top: 24px;
  bottom: 24px;
  left: -6px;
  width: 2px;
  background-color: #E5E7EB;
  z-index: 0;
}

#cards-container .work-card::after {
  content: "";
  position: absolute;
  top: 24px;
  left: -19px;
  width: 10px;
  height: 10px;
  background-color: #FFFFFF;
  border: 2px solid #D1D5DB;
  border-radius: 50%;
  z-index: 1;
  box-sizing: border-box;
}
`;

css = css.trim() + '\n\n' + newCSS;

fs.writeFileSync('popup.css', css);
console.log('Fixed popup.css');
