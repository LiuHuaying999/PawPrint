const fs = require('fs');

let css = fs.readFileSync('popup.css', 'utf8');

const newCSS = `
/* 爪印时间轴样式 */
#cards-container {
  padding-left: 20px;
  position: relative;
}

#cards-container::before {
  content: "";
  position: absolute;
  top: 24px;
  bottom: 24px;
  left: 6px;
  width: 2px;
  background-color: #E5E7EB;
  z-index: 0;
}

#cards-container .work-card::after {
  content: "";
  position: absolute;
  top: 24px;
  left: -18px;
  width: 10px;
  height: 10px;
  background-color: #FFFFFF;
  border: 2px solid #D1D5DB;
  border-radius: 50%;
  z-index: 1;
  box-sizing: border-box;
}
`;

css += '\n' + newCSS;

fs.writeFileSync('popup.css', css);
console.log('patched');
