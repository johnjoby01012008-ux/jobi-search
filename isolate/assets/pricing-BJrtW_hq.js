function i(o,t="INR"){return o===void 0||!Number.isFinite(o)?"—":`${t==="INR"?"₹":`${t} `}${Math.round(o).toLocaleString("en-IN")}`}export{i as f};
